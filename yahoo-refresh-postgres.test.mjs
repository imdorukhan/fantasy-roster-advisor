import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {createYahooSessionClient} from './yahoo-session-client.mjs';

const url=process.env.YAHOO_REFRESH_TEST_DATABASE_URL;
test('refresh coordination on disposable local PostgreSQL', {skip:!url}, async t=>{
  const parsed=new URL(url);
  assert.ok(['127.0.0.1','localhost'].includes(parsed.hostname));
  assert.equal(parsed.pathname,'/sc3_refresh_test');
  const {Pool}=await import('pg');
  const pool=new Pool({connectionString:url,max:8});
  t.after(()=>pool.end());
  await pool.query(`
    do $$ begin
      if not exists(select from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
      if not exists(select from pg_roles where rolname='sc3_app') then create role sc3_app nologin; end if;
      if not exists(select from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
    end $$;
    drop schema if exists sc3 cascade;
    drop schema public cascade;
    create schema public;
    create schema sc3;
    create table public.yahoo_oauth_sessions(session_hash text primary key,token_ciphertext text not null,expires_at timestamptz not null);
    create table sc3.yahoo_oauth_sessions(like public.yahoo_oauth_sessions including all);
    grant usage on schema public to anon,authenticated,service_role;
    grant usage on schema sc3 to sc3_app;
    grant select,update on public.yahoo_oauth_sessions to service_role;
    grant select,update on sc3.yahoo_oauth_sessions to sc3_app;
  `);
  await pool.query(readFileSync(new URL('./supabase/development/sc3_yahoo_refresh.sql',import.meta.url),'utf8'));
  async function invoke(role,sql,args=[]){
    const c=await pool.connect();
    try{await c.query('begin');await c.query('set local role '+role);const r=await c.query(sql,args);await c.query('commit');return r.rows[0]?.result}
    catch(e){await c.query('rollback');throw e}finally{c.release()}
  }
  async function seed(schema='public',tokens={access_token:'fixture-old',refresh_token:'fixture-refresh',expires_at:Date.now()-1}){
    const hash=randomBytes(32).toString('hex');
    const cipher=JSON.stringify(tokens);
    await pool.query('insert into '+schema+'.yahoo_oauth_sessions values($1,$2,now()+interval \'30 days\')',[hash,cipher]);
    return {hash,cipher,tokens};
  }
  const claim=(hash,id=randomUUID())=>invoke('service_role','select public.yahoo_refresh_claim($1,$2) as result',[hash,id]).then(r=>({...r,id}));
  const finish=(hash,id,expected,replacement)=>invoke('service_role','select public.yahoo_refresh_finish($1,$2,$3,$4) as result',[hash,id,expected,replacement]);

  await t.test('two independent transactions acquire only one claim',async()=>{
    const row=await seed();
    const results=await Promise.all([claim(row.hash),claim(row.hash)]);
    assert.deepEqual(results.map(r=>r.state).sort(),['acquired','busy']);
  });
  await t.test('finalization is idempotent after a lost acknowledgement',async()=>{
    const row=await seed(),held=await claim(row.hash);
    assert.equal(await finish(row.hash,held.id,row.cipher,'fixture-replacement'),true);
    assert.equal(await finish(row.hash,held.id,row.cipher,'fixture-replacement'),true);
    assert.equal((await pool.query('select token_ciphertext from public.yahoo_oauth_sessions where session_hash=$1',[row.hash])).rows[0].token_ciphertext,'fixture-replacement');
  });
  await t.test('the same claim can be recovered after losing its acknowledgement',async()=>{
    const row=await seed(),id=randomUUID();
    assert.equal((await claim(row.hash,id)).state,'acquired');
    assert.equal((await claim(row.hash,id)).state,'acquired');
    assert.equal((await claim(row.hash)).state,'busy');
  });
  await t.test('an expired claim becomes uncertain instead of granting another exchange',async()=>{
    const row=await seed();await claim(row.hash);
    await pool.query('update sc3.yahoo_refresh_locks set lease_until=now()-interval \'1 second\' where session_hash=$1',[row.hash]);
    assert.equal((await claim(row.hash)).state,'uncertain');
    assert.equal((await claim(row.hash)).state,'uncertain');
  });
  await t.test('an uncertain claim can still persist its own original result',async()=>{
    const row=await seed(),held=await claim(row.hash);
    await invoke('service_role','select public.yahoo_refresh_uncertain($1,$2) as result',[row.hash,held.id]);
    assert.equal(await finish(row.hash,held.id,row.cipher,'fixture-recovered'),true);
  });
  await t.test('a newer session invalidates the old claim and cannot be overwritten',async()=>{
    const row=await seed(),held=await claim(row.hash);
    await pool.query('update public.yahoo_oauth_sessions set token_ciphertext=$2 where session_hash=$1',[row.hash,'fixture-new-login']);
    assert.equal(await finish(row.hash,held.id,row.cipher,'fixture-stale-result'),false);
    assert.equal((await claim(row.hash)).state,'acquired');
  });
  await t.test('logout cannot be undone by a delayed refresh save',async()=>{
    const row=await seed(),held=await claim(row.hash);
    await pool.query('delete from public.yahoo_oauth_sessions where session_hash=$1',[row.hash]);
    assert.equal(await finish(row.hash,held.id,row.cipher,'fixture-result'),false);
    assert.equal((await claim(row.hash)).state,'missing');
  });
  await t.test('anonymous and authenticated roles cannot call the REST refresh RPCs',async()=>{
    for(const role of ['anon','authenticated']){
      await assert.rejects(invoke(role,'select public.yahoo_refresh_claim($1,$2) as result',['a'.repeat(64),randomUUID()]),e=>e.code==='42501');
    }
  });
  await t.test('sc3_app can coordinate its own schema but cannot access production sessions',async()=>{
    const row=await seed('sc3');
    const r=await invoke('sc3_app','select sc3.yahoo_refresh_claim($1,$2,$3) as result',['sc3',row.hash,randomUUID()]);
    assert.equal(r.state,'acquired');
    await assert.rejects(invoke('sc3_app','select sc3.yahoo_refresh_claim($1,$2,$3) as result',['public',row.hash,randomUUID()]),e=>e.code==='42501');
  });
  await t.test('separate application clients share one actual database claim and OAuth exchange',async()=>{
    const row=await seed();let exchanges=0;
    const store={
      async claim(hash){const r=await claim(hash);return {...r,tokens:r.ciphertext?JSON.parse(r.ciphertext):undefined}},
      finish:(held,tokens)=>finish(row.hash,held.id,held.ciphertext,tokens?JSON.stringify(tokens):null),
      uncertain:held=>invoke('service_role','select public.yahoo_refresh_uncertain($1,$2) as result',[row.hash,held.id])
    };
    const deps={store,exchange:async()=>{exchanges++;await new Promise(resolve=>setTimeout(resolve,20));return {access_token:'fixture-new',refresh_token:'fixture-rotated',expires_in:3600}},read:async()=>({ok:true}),pause:()=>new Promise(resolve=>setTimeout(resolve,5))};
    const clients=Array.from({length:3},()=>createYahooSessionClient({hash:row.hash,tokens:row.tokens},deps));
    await Promise.all([clients[0].ready(),clients[1].ready(),clients[2].ready({force:true})]);
    assert.equal(exchanges,1);
  });
});
