import test from 'node:test';
import assert from 'node:assert/strict';
import {pgConfig,withScopedTransaction,scopedSyncStore} from './sc3-postgres.mjs';
const env={SC3_SHARED_DB:'1',SC3_DATABASE_URL:'postgresql://sc3_app:test-only@db.bmsfbcuausbfzheufjtc.supabase.co:5432/postgres'};
test('scoped config rejects privileged users, alternate hosts and TLS override',()=>{assert.equal(pgConfig(env).ssl.rejectUnauthorized,true);for(const url of [env.SC3_DATABASE_URL.replace('sc3_app','postgres'),env.SC3_DATABASE_URL.replace('db.bmsfbcuausbfzheufjtc.supabase.co','example.com'),env.SC3_DATABASE_URL+'?sslmode=disable'])assert.throws(()=>pgConfig({...env,SC3_DATABASE_URL:url}));assert.throws(()=>pgConfig({...env,SC3_SHARED_DB:'0'}))});
function fixture(legacy=false){const queries=[];const c={query:async(sql,args)=>{queries.push(sql);if(sql.includes('session_user as login'))return {rows:[{role:'sc3_app',login:'sc3_app',allowed:true,legacy_access:legacy}]};if(sql.startsWith('select observed_at'))return {rows:[]};if(sql.startsWith('insert into sc3.sc3_nba_game_logs'))return {rowCount:1};return {rows:[]}},release(){queries.push('RELEASE')}};return {queries,pool:{connect:async()=>c}}}
test('role guard prevents any legacy access and rolls back',async()=>{const f=fixture(true);let ran=false;await assert.rejects(withScopedTransaction(async()=>{ran=true},{pool:f.pool}));assert.equal(ran,false);assert.ok(f.queries.includes('ROLLBACK'));assert.ok(f.queries.includes('RELEASE'))});
test('read transaction commits only after scoped role validation',async()=>{const f=fixture();assert.equal(await withScopedTransaction(async()=>42,{pool:f.pool}),42);assert.match(f.queries[0],/SET idle_in_transaction_session_timeout/);assert.match(f.queries[1],/READ ONLY/);assert.ok(f.queries.includes('COMMIT'))});
test('sync transaction atomically replaces only the requested day',async()=>{const f=fixture();const n=await scopedSyncStore({pool:f.pool}).save({p_day:'2026-11-16',p_observed:'2026-11-17T12:00:00Z',p_events:1,p_rows:[{game_day:'2026-11-16',event_id:'1'}]});assert.equal(n,1);assert.ok(f.queries.includes('COMMIT'));assert.ok(f.queries.some(q=>q.startsWith('delete from sc3.sc3_nba_game_logs where game_day=$1')));assert.ok(!f.queries.some(q=>/^(insert into|delete from|update) public\./.test(q)))});

test('session pooler accepts scoped encoded and raw password characters without host substitution',()=>{
 const prefix='postgresql://sc3_app.bmsfbcuausbfzheufjtc:',suffix='@aws-0-us-west-1.pooler.supabase.com:5432/postgres';
 const password='example#/?@%&';
 const encoded=pgConfig({...env,SC3_DATABASE_URL:prefix+encodeURIComponent(password)+suffix});
 const raw=pgConfig({...env,SC3_DATABASE_URL:prefix+password+suffix});
 assert.equal(encoded.password,password);assert.equal(raw.password,password);
 assert.equal(raw.host,'aws-0-us-west-1.pooler.supabase.com');assert.equal(raw.ssl.rejectUnauthorized,true);
 for(const url of [prefix+'sample@evil.example:5432/postgres',prefix+'sample'+suffix+'?sslmode=disable',prefix+'sample'+suffix.replace(':5432',':6543'),prefix.replace('sc3_app.','postgres.')+'sample'+suffix])assert.throws(()=>pgConfig({...env,SC3_DATABASE_URL:url}));
});

test('official Supabase CA roots are self-signed valid trust anchors',async()=>{
 const {X509Certificate}=await import('node:crypto');
 const c=pgConfig(env);
 assert.equal(c.ssl.rejectUnauthorized,true);
 assert.equal(c.ssl.minVersion,'TLSv1.2');
 assert.equal(c.ssl.ca.length,2);
 for(const pem of c.ssl.ca){const cert=new X509Certificate(pem);assert.equal(cert.ca,true);assert.equal(cert.subject,cert.issuer);assert.equal(cert.verify(cert.publicKey),true);assert.match(cert.subject,/Supabase Root (2021|2025) CA/);assert.ok(Date.parse(cert.validTo)>Date.parse('2026-11-17'))}
});
