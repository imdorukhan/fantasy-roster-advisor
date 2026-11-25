import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createPoolProvider,acquireScopedClient,managedTransaction,pgConfig,SC3_IDLE_TRANSACTION_MS} from './sc3-postgres.mjs';
import {readP2Lab} from './sc3-p2-lab.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('cold start pool is initialized once across overlapping callers and failed initialization can recover',async()=>{
 let calls=0;const pool={};
 const get=createPoolProvider(async()=>{calls++;await sleep(5);return pool});
 assert.ok((await Promise.all(Array.from({length:20},get))).every(p=>p===pool));assert.equal(calls,1);
 let n=0;const failing=createPoolProvider(async()=>{if(++n===1)throw Error('fixture');return pool;});
 await assert.rejects(failing(),/fixture/);assert.equal(await failing(),pool);assert.equal(n,2);
 const c=pgConfig({SC3_SHARED_DB:'1',SC3_DATABASE_URL:'postgresql://sc3_app:fixture@db.bmsfbcuausbfzheufjtc.supabase.co/postgres'});
 assert.equal(c.max,1);assert.equal(c.connectionTimeoutMillis,5000);assert.equal(c.query_timeout,22000);
});
test('connection acquisition retries capacity errors only, never retries authentication or SQL work',async()=>{
 let attempts=0;const pauses=[],client={};
 const pool={connect:async()=>{if(++attempts<3)throw Object.assign(Error('capacity'),{code:'53300'});return client}};
 assert.equal(await acquireScopedClient(pool,{pause:async ms=>pauses.push(ms)}),client);
 assert.equal(attempts,3);assert.deepEqual(pauses,[150,300]);
 attempts=0;await assert.rejects(acquireScopedClient({connect:async()=>{attempts++;throw Object.assign(Error('auth'),{code:'28P01'})}},{pause:async()=>{}}),/auth/);assert.equal(attempts,1);
 attempts=0;await assert.rejects(acquireScopedClient({connect:async()=>{attempts++;throw Object.assign(Error('capacity'),{code:'53300'})}},{pause:async()=>{}}),/capacity/);assert.equal(attempts,3);
});
function mock(fail){
 const events=[],c=new EventEmitter();c.query=async sql=>{events.push(sql);if(fail?.(sql))throw Error('fixture query failure');return {rows:[]}};c.release=destroy=>events.push(['release',destroy]);return {events,c,pool:{connect:async()=>c}};
}
test('timeout is installed BEFORE BEGIN; success and errors always destroy checked-out client',async()=>{
 for(const point of ['none','SET idle','BEGIN','COMMIT','callback','verify']){
  const f=mock(sql=>point!=='none'&&sql.startsWith(point));let ran=0;
  const task=managedTransaction(async()=>{ran++;if(point==='callback')throw Error('fixture callback');return 42},{pool:f.pool,verify:async()=>{if(point==='verify')throw Error('fixture verify')}});
  if(point==='none')assert.equal(await task,42);else await assert.rejects(task,/fixture/);
  assert.match(f.events[0],/SET idle_in_transaction_session_timeout/);
  assert.deepEqual(f.events.at(-1),['release',true]);assert.equal(f.c.listenerCount('error'),0);
  if(point==='BEGIN'||point==='COMMIT'||point==='callback'||point==='verify')assert.ok(f.events.includes('ROLLBACK'));
  if(point==='SET idle')assert.ok(!f.events.some(x=>typeof x==='string'&&x.startsWith('BEGIN')));
  assert.ok(ran<=1);
 }
});
test('connection loss while checked out is handled and never replayed',async()=>{
 const f=mock();let ran=0;
 await assert.rejects(managedTransaction(async()=>{ran++;f.c.emit('error',Error('closed'));throw Error('closed')},{pool:f.pool,verify:async()=>{}}),/closed/);
 assert.equal(ran,1);assert.ok(!f.events.includes('ROLLBACK'));assert.deepEqual(f.events.at(-1),['release',true]);
});
test('P2 Lab serializes database work and reuses one catalog while HTTP-only sources run concurrently',async()=>{
 let active=0,max=0,catalogReads=0,network=0;const calls=[],catalog=[{espnId:'1',name:'Fixture',team:'SAC'}];
 const db=(name,value)=>async()=>{calls.push(name);active++;max=Math.max(max,active);await sleep(3);active--;return value;};
 const out=await readP2Lab({history:db('history',{observations:12}),catalog:async()=>{catalogReads++;return db('catalog',catalog)()},ledgerRead:db('ledger',{status:'UNAVAILABLE'}),backtestRead:db('backtest',{available:true}),cbsMetricsRead:db('cbsMetrics',{status:'UNAVAILABLE'}),espn:async()=>null,
 cbsRead:async opts=>{assert.equal(opts.catalog,catalog);network++;await sleep(15);return {source:'CBS',rows:[]}},
 nbaRead:async opts=>{assert.equal(opts.catalog,catalog);network++;await sleep(15);return {source:'NBA_OFFICIAL',matched:1}}});
 assert.equal(max,1);assert.equal(catalogReads,1);assert.equal(network,2);assert.deepEqual(calls,['history','catalog','ledger','backtest','cbsMetrics']);assert.equal(out.nbaOfficialEvidence.matched,1);assert.equal(out.historyCoverage.observations,12);assert.equal(out.snapshotWrites,0);
});
const ci=process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true';
test('disposable PostgreSQL: concurrent workers under role limit four and server reclaim after abandoned read transaction',{skip:!ci,timeout:60000},async()=>{
 const {Pool,Client}=await import('pg');
 const base={host:'127.0.0.1',port:5432,database:'sc3_refresh_test',connectionTimeoutMillis:3000};
 const admin=new Client({...base,user:'postgres',password:'fixture-ci-only'}),role='sc3_p0_ci_login',password='fixture-p0-local-only';
 await admin.connect();const pools=[];
 try{
  await admin.query("create role "+role+" login connection limit 4 password '"+password+"'");
  for(let i=0;i<6;i++){const p=new Pool({...base,user:role,password,max:1,query_timeout:22000,statement_timeout:20000});p.on('error',()=>{});pools.push(p);}
  const verify=async c=>{const r=(await c.query("select current_user as role,current_setting('transaction_read_only') as readonly,current_setting('idle_in_transaction_session_timeout') as timeout")).rows[0];assert.equal(r.role,role);assert.equal(r.readonly,'on');assert.equal(r.timeout,'15s');};
  let completed=0;const results=await Promise.all(Array.from({length:12},(_,i)=>managedTransaction(async c=>{
   const count=(await c.query('select count(*)::int as n from pg_stat_activity where usename=current_user')).rows[0].n;assert.ok(count<=4&&count>=1);
   await c.query('select pg_sleep(0.035)');completed++;return i;
  },{pool:pools[i%6],verify})));
  assert.equal(completed,12);assert.equal(new Set(results).size,12);
  // Simulate a runtime frozen immediately after BEGIN with an actual backend.
  // The test shortens the timeout only inside this disposable transaction.
  await assert.rejects(managedTransaction(async c=>{
   await c.query("SET LOCAL idle_in_transaction_session_timeout TO '200ms'");
   await sleep(600);
   return c.query('select 1');
  },{pool:pools[0],verify}));
  assert.equal(await managedTransaction(async c=>(await c.query('select 42 as n')).rows[0].n,{pool:pools[0],verify}),42);
  for(const p of pools)await p.end();
  pools.length=0;await sleep(100);
  assert.equal((await admin.query('select count(*)::int as n from pg_stat_activity where usename=$1',[role])).rows[0].n,0);
 }finally{await Promise.allSettled(pools.map(p=>p.end()));await admin.query('drop role if exists '+role);await admin.end();}
});
