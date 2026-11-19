import test from 'node:test';
import assert from 'node:assert/strict';
import {collect} from './scripts/collect-yahoo-ownership.mjs';
import {collectBatch,fullSync,validateBatch,saveBatch,verifyBatch,sections} from './sc3-yahoo-full-sync.mjs';
import {findTeams,findPlayers} from './api/auto-data.js';
import handler from './api/sc3-yahoo-sync.js';

const secret='fixture-private-cron-secret-more-than-32-characters';
const instant=Date.parse('2026-11-18T22:00:00Z');
const copy=x=>structuredClone(x);
const position='<span class="Fz-xxs">BOS - PG, SG</span>';
const row=(id,status='W (Nov 19)')=>`<tr><td><a class="name" data-ys-playerid="${id}">O&#39;Neal ${id}</a>${position}</td><td></td><td></td><td></td><td>${status}</td></tr>`;
function page(filter,rows,next){return `/nba/85892/<select><option value="${filter}" selected>${filter==='FA'?'Free Agents Only':'Waivers Only'}</option></select>${rows}${next?`<a href="${next}">Next 25</a>`:'<li>Next 25</li>'}`}
function fixture(){
  const calls={api:[],pages:[]},logs=[];
  let pass=0;
  const read=async path=>{
    calls.api.push(path);
    if(path.endsWith('/teams?format=json')){
      pass++;
      return {league:[{league_key:'478.l.85892'},{teams:{count:14,...Object.fromEntries(Array.from({length:14},(_,i)=>[i,{team:[[{team_key:`478.l.85892.t.${i+1}`},{name:`Team ${i+1}`}]]}]))}}]};
    }
    const team=path.match(/\.t\.(\d+)\/roster/);
    if(team)return {team:[{roster:{players:{count:1,0:{player:[[{player_id:team[1]},{name:{full:`Fixture ${team[1]}`}},{editorial_team_abbr:'BOS'},{eligible_positions:[{position:'PG'}]}],{selected_position:[{position:'PG'}]}]}}}}]};
    const section=path.match(/\/(settings|standings|scoreboard)\?/)[1];
    return {league:[{league_key:'478.l.85892'},{[section]:{verified:'fixture'}}]};
  };
  const fetcher=async url=>{
    calls.pages.push(url.href);
    const filter=url.searchParams.get('status'), offset=Number(url.searchParams.get('count')??0);
    const html=filter==='FA'?page('FA','<p>No players found</p>'):offset===0?page('W',Array.from({length:25},(_,i)=>row(100+i)).join(''),'/nba/85892/players?status=W&sort=OR&count=25'):page('W',row(125));
    return {status:200,url:url.href,text:async()=>html};
  };
  const collector=(filter,onPage,options)=>collect(filter,onPage,{...options,fetcher});
  const deps={env:{CRON_SECRET:secret,SC3_SHARED_DB:'1',SC3_YAHOO_FULL_SYNC_ENABLED:'1'},now:()=>instant,loadSession:async()=>({tokens:{fixture:true}}),createClient:()=>({ready:async()=>{},read}),findTeams,findPlayers,collector,log:line=>logs.push(line)};
  return {deps,calls,logs,pass:()=>pass};
}
const req=()=>({method:'GET',headers:{authorization:'Bearer '+secret}});
function response(){return {setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}}}

test('real Yahoo-shaped parsers collect 14 rosters, explicit empty FA and every waiver page',async()=>{
  const f=fixture(),batch=await collectBatch({client:f.deps.createClient(),...f.deps});
  assert.equal(batch.length,8);
  assert.equal(batch.find(r=>r.section==='all_rosters').payload.playerCount,14);
  const w=batch.find(r=>r.section==='waivers').payload;
  assert.equal(w.count,26);assert.equal(w.pageCount,2);
  assert.equal(w.players[0].nbaTeam,'BOS');assert.deepEqual(w.players[0].eligiblePositions,['PG','SG']);
  assert.equal(w.players[0].name,"O'Neal 100");
  assert.equal(batch.find(r=>r.section==='free_agents').payload.count,0);
  assert.equal(f.calls.pages.length,3);
});

test('default dry run makes two full observations and does not write snapshots',async()=>{
  const f=fixture(),res=response();
  f.deps.save=()=>assert.fail('Unexpected write');
  await fullSync(req(),res,f.deps);
  assert.equal(res.code,200);assert.equal(res.body.status,'VALIDATED');
  assert.equal(res.body.snapshotWrites,0);assert.equal(f.pass(),2);assert.equal(f.calls.pages.length,6);
  assert.doesNotMatch(f.logs.join(''),/O.Neal|Fixture|fixture-private|players\":/);
});

test('route authorization and disabled gates precede any session or source access',async()=>{
  for(const request of [{method:'GET',headers:{}},{method:'POST',headers:{}},{method:'GET',headers:{authorization:'Bearer '+'é'.repeat(secret.length)}}]){
    const f=fixture(),res=response();f.deps.loadSession=()=>assert.fail('Session read');
    await fullSync(request,res,f.deps);assert.ok([401,405].includes(res.code));
  }
  const f=fixture(),res=response();f.deps.env.SC3_YAHOO_FULL_SYNC_ENABLED='0';f.deps.loadSession=()=>assert.fail('Session read');
  await fullSync(req(),res,f.deps);assert.equal(res.code,404);
  const actual=response();await handler({method:'GET',headers:{}},actual);assert.equal(actual.code,401);
});

test('invalid coverage, duplicate IDs, group overlap and unsafe metadata reject the whole batch',async()=>{
  const f=fixture(),base=await collectBatch({client:f.deps.createClient(),...f.deps});
  const mutations=[
    b=>b[0].payload.teams.pop(),
    b=>b[0].payload.teams[1].players[0].yahooId='1',
    b=>b.find(r=>r.section==='waivers').payload.players[0].yahooId='1',
    b=>b.find(r=>r.section==='waivers').payload.players[0].nbaTeam='bos',
    b=>b.find(r=>r.section==='waivers').payload.players[0].eligiblePositions=['G'],
    b=>b.find(r=>r.section==='waivers').payload.complete=false,
    b=>b[0].observed_at=new Date(instant+1).toISOString(),
    b=>b[0].payload.playerCount=205
  ];
  for(const mutate of mutations){const batch=copy(base);mutate(batch);assert.throws(()=>validateBatch(batch,instant),{code:'invalid_yahoo_batch'})}
});

test('a changed NBA team or eligible position between observations prevents saving',async()=>{
  for(const field of ['nbaTeam','eligiblePositions']){
    const f=fixture(),original=f.deps.collector;let calls=0,saves=0;
    f.deps.env.SC3_YAHOO_FULL_SYNC_WRITE='1';
    f.deps.collector=(filter,onPage,options)=>original(filter,page=>{
      if(++calls>3 && page.players.length)page.players[0][field]=field==='nbaTeam'?'LAL':['C'];
      onPage(page);
    },options);
    f.deps.save=()=>{saves++};const res=response();await fullSync(req(),res,f.deps);
    assert.equal(res.body.category,'ownership_changed_during_collection');assert.equal(saves,0);
  }
});

test('missing pages, non-200s, changed pagination scope and redirects fail closed',async()=>{
  for(const kind of ['http','redirect','offset','scope']){
    let n=0;
    await assert.rejects(collect('W',()=>{},{fetcher:async url=>{
      n++;
      return {status:kind==='http'?206:200,url:kind==='redirect'?'https://login.yahoo.com':url.href,text:async()=>page('W',Array.from({length:25},(_,i)=>row(100+n*25+i)).join(''),`/nba/85892/players?status=W&sort=${kind==='scope'&&n>1?'AR':'OR'}&count=${kind==='offset'?50:n*25}`)};
    }}));
  }
  const f=fixture(),original=f.deps.collector;
  f.deps.collector=(filter,onPage,options)=>original(filter,p=>{if(p.offset===0)onPage(p)},options);
  const res=response();await fullSync(req(),res,f.deps);assert.equal(res.body.category,'incomplete_ownership_pages');
});

test('write mode reports commit separately from independent read-back failure',async()=>{
  const f=fixture();f.deps.env.SC3_YAHOO_FULL_SYNC_WRITE='1';let saved;
  f.deps.save=async b=>{saved=b;return {changedSections:['waivers']}};
  f.deps.verify=async b=>{assert.equal(b,saved);return {historyMatches:8,overlap:0}};
  let res=response();await fullSync(req(),res,f.deps);
  assert.equal(res.body.status,'PASS');assert.equal(res.body.snapshotWrites,8);assert.equal(res.body.notify,true);
  f.deps.verify=async()=>{throw Error('private response detail')};res=response();await fullSync(req(),res,f.deps);
  assert.equal(res.body.committed,true);assert.equal(res.body.category,'snapshot_readback_failed');assert.doesNotMatch(f.logs.join(''),/private response detail/);
});

test('an upstream authorization failure is sanitized and never writes',async()=>{
  const f=fixture();f.deps.loadSession=async()=>null;f.deps.save=()=>assert.fail('Unexpected write');
  const res=response();await fullSync(req(),res,f.deps);assert.equal(res.body.category,'owner_authorization_unavailable');
});

test('lost write acknowledgements recover by read-back only, or report an unknown commit',async()=>{
  const f=fixture();f.deps.env.SC3_YAHOO_FULL_SYNC_WRITE='1';let writes=0;
  f.deps.save=async()=>{writes++;throw Error('private database response')};
  f.deps.verify=async()=>({historyMatches:8,overlap:0});
  let res=response();await fullSync(req(),res,f.deps);
  assert.equal(res.body.status,'PASS');assert.equal(res.body.category,'write_ack_recovered');assert.equal(writes,1);
  f.deps.verify=async()=>{throw Error('private verification response')};
  res=response();await fullSync(req(),res,f.deps);
  assert.equal(res.body.committed,null);assert.equal(res.body.snapshotWrites,null);assert.equal(writes,2);
  assert.equal(res.body.category,'snapshot_write_failed');assert.doesNotMatch(f.logs.join(''),/private database|private verification/);
});

// Dedicated disposable DB avoids the refresh suite's schema-reset fixture.
const url=process.env.YAHOO_REFRESH_TEST_DATABASE_URL;
test('full Yahoo atomic save, concurrency and read-back on PostgreSQL',{skip:!url},async t=>{
  const {Pool}=await import('pg'),parsed=new URL(url);
  assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));assert.equal(parsed.pathname,'/sc3_refresh_test');
  const admin=new Pool({connectionString:url}),name='sc3_yahoo_full_'+process.pid;
  await admin.query('create database '+name);parsed.pathname='/'+name;
  const pool=new Pool({connectionString:parsed.href});
  t.after(async()=>{await pool.end();await admin.query('drop database '+name);await admin.end()});
  await pool.query(`create schema sc3;
    create table sc3.yahoo_league_snapshots(league_id integer not null,section text not null,payload jsonb not null,observed_at timestamptz not null,source text not null,primary key(league_id,section));
    create table sc3.yahoo_league_snapshot_history(id bigserial primary key,league_id integer not null,section text not null,payload jsonb not null,observed_at timestamptz not null);`);
  const transaction=async(fn,{readOnly}={})=>{const c=await pool.connect();try{await c.query(readOnly?'begin isolation level repeatable read read only':'begin');const r=await fn(c);await c.query('commit');return r}catch(e){await c.query('rollback');throw e}finally{c.release()}};
  const f=fixture(),base=await collectBatch({client:f.deps.createClient(),...f.deps});
  const at=millis=>{const batch=copy(base);for(const r of batch)r.observed_at=new Date(instant+millis).toISOString();batch[0].payload.observedAt=batch[0].observed_at;return batch};
  const opts={transaction,now:()=>instant+60_000};
  await t.test('all eight snapshots and their exact returned payloads commit together',async()=>{
    const result=await saveBatch(base,opts);assert.equal(result.changedSections.length,8);
    const checked=await verifyBatch(base,opts);assert.equal(checked.historyMatches,8);assert.equal(checked.waivers,26);assert.equal(checked.overlap,0);
    assert.equal((await pool.query("select payload->'players'->0->>'name' as name from sc3.yahoo_league_snapshots where section='waivers'")).rows[0].name,"O'Neal 100");
  });
  await t.test('same/stale observations roll back without adding history',async()=>{
    await assert.rejects(saveBatch(base,opts),{code:'older_observation'});
    assert.equal((await pool.query('select count(*)::int as n from sc3.yahoo_league_snapshot_history')).rows[0].n,8);
  });
  await t.test('timestamp-only and response ordering changes do not notify; positions do',async()=>{
    const batch=at(1000);batch[0].payload.teams.reverse();
    assert.deepEqual((await saveBatch(batch,opts)).changedSections,[]);
    const changed=at(2000);changed.find(r=>r.section==='waivers').payload.players[0].eligiblePositions=['C'];
    assert.deepEqual((await saveBatch(changed,opts)).changedSections,['waivers']);
  });
  await t.test('a history write failure rolls back every snapshot',async()=>{
    await pool.query("create function sc3.block_history() returns trigger language plpgsql as $$begin raise exception 'fixture failure'; end$$; create trigger block_history before insert on sc3.yahoo_league_snapshot_history for each row execute function sc3.block_history();");
    await assert.rejects(saveBatch(at(3000),opts));
    assert.equal((await pool.query("select count(*)::int as n from sc3.yahoo_league_snapshots where observed_at=$1",[new Date(instant+2000)])).rows[0].n,8);
    await pool.query('drop trigger block_history on sc3.yahoo_league_snapshot_history');
  });
  await t.test('concurrent writers preserve one whole latest batch',async()=>{
    await Promise.allSettled([saveBatch(at(4000),opts),saveBatch(at(5000),opts)]);
    assert.equal((await pool.query('select count(distinct observed_at)::int as n from sc3.yahoo_league_snapshots')).rows[0].n,1);
    assert.equal((await verifyBatch(at(5000),opts)).historyMatches,8);
    await pool.query("delete from sc3.yahoo_league_snapshot_history where section='waivers'");
    await assert.rejects(verifyBatch(at(5000),opts),{code:'snapshot_readback_failed'});
  });
});
