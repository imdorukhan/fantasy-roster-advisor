import {supabaseRoots} from './sc3-supabase-ca.mjs';
// Only explicit scoped credentials; never reuse a Supabase service-role key.
const ref='bmsfbcuausbfzheufjtc';
export function pgConfig(env=process.env){
 if(env.SC3_SHARED_DB!=='1')throw Error('Shared SC3 database is not enabled');
 const raw=String(env.SC3_DATABASE_URL||'').trim();
 if(!raw)throw Error('SC3 database URL missing');
 const approved=[
  {host:'db.'+ref+'.supabase.co',user:'sc3_app'},
  {host:'aws-0-us-west-1.pooler.supabase.com',user:'sc3_app.'+ref}
 ];
 // Conventional percent-encoded URI. Also accept a raw password only when
 // the entire fixed username/host/database envelope matches exactly.
 // No parsed host, options, query string or TLS override can be injected.
 for(const {host,user} of approved)for(const scheme of ['postgresql','postgres'])for(const port of [':5432','']){
  const prefix=scheme+'://'+user+':',suffix='@'+host+port+'/postgres';
  if(!raw.startsWith(prefix)||!raw.endsWith(suffix))continue;
  const segment=raw.slice(prefix.length,-suffix.length);
  if(!segment||/[\r\n\u0000]/.test(segment))throw Error('SC3 database password segment invalid');
  let password=segment;
  try{
   const u=new URL(raw);
   if(u.protocol===scheme+':'&&u.hostname===host&&decodeURIComponent(u.username)===user&&u.pathname==='/postgres'&&!u.search&&!u.hash&&(u.port===''||u.port==='5432')){
    password=decodeURIComponent(u.password);
   }
  }catch{ /* Raw password in an exact fixed envelope; never log it. */ }
  if(!password)throw Error('SC3 database password segment invalid');
  return {host,port:5432,database:'postgres',user,password,ssl:{ca:supabaseRoots,rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeoutMillis:5000,statement_timeout:20000,query_timeout:22000,idleTimeoutMillis:1000,allowExitOnIdle:true,max:1};
 }
 // These error labels describe only the public connection envelope.
 if(!/^postgres(?:ql)?:\/\//.test(raw))throw Error('SC3 database URL scheme missing');
 if(!approved.some(({user})=>raw.startsWith('postgresql://'+user+':')||raw.startsWith('postgres://'+user+':')))throw Error('SC3 database URL role mismatch');
 throw Error('SC3 database URL endpoint mismatch');
}
// One pool initialization per process, even when cold-start requests overlap.
// Never replay a transaction (especially a write) after an ambiguous result.
export function createPoolProvider(create){
 let pending;
 return function get(){
  if(!pending)pending=Promise.resolve().then(create).catch(error=>{pending=undefined;throw error});
  return pending;
 };
}
export const scopedPool=createPoolProvider(async()=>{
 const {Pool}=await import('pg');
 const p=new Pool(pgConfig());
 // pg emits idle client errors; do not leak provider messages or connection strings.
 p.on('error',()=>{});
 return p;
});
export function isConnectionCapacityError(error){
 return ['53300','57P03','08001','08006','ECONNRESET','ETIMEDOUT'].includes(error?.code)
  || /too many connections for role|remaining connection slots|timeout exceeded when trying to connect|connection terminated unexpectedly/i.test(String(error?.message??''));
}
export async function acquireScopedClient(pool,{pause=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 for(let attempt=0;;attempt++){
  try{return await pool.connect();}
  catch(error){if(attempt>=2||!isConnectionCapacityError(error))throw error;await pause(150*(attempt+1));}
 }
}
export const SC3_IDLE_TRANSACTION_MS=15000;
const roleSQL="select current_user as role, session_user as login, has_schema_privilege(current_user,'sc3','USAGE') as allowed, exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') and (has_table_privilege(current_user,c.oid,'SELECT') or has_table_privilege(current_user,c.oid,'INSERT') or has_table_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE'))) as legacy_access";
async function verifyScopedRole(c){
 const row=(await c.query(roleSQL)).rows[0];
 if(row?.role!=='sc3_app'||row.login!=='sc3_app'||row.allowed!==true||row.legacy_access!==false)throw Error('Scoped role verification failed');
}
// The server-side timeout MUST be installed before BEGIN: a frozen serverless
// instance can stop immediately after any await, even the BEGIN acknowledgement.
// No reliance on JS idle timers for reclaiming role slots.
export async function managedTransaction(fn,{pool,readOnly=true,verify,acquire=acquireScopedClient}){
 const c=await acquire(pool);
 let began=false,connectionFailed=false;
 const onError=()=>{connectionFailed=true;};
 c.on?.('error',onError);
 try{
  await c.query("SET idle_in_transaction_session_timeout TO '"+SC3_IDLE_TRANSACTION_MS+"ms'");
  began=true; // BEGIN may succeed server-side even if its acknowledgement is lost.
  await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');
  await c.query("SET LOCAL search_path TO pg_catalog, sc3");
  await verify(c);
  const result=await fn(c);
  await c.query('COMMIT');
  began=false;
  return result;
 }catch(error){
  if(began&&!connectionFailed){try{await c.query('ROLLBACK')}catch{}}
  throw error;
 }finally{
  // Destroy rather than return an idle client. A frozen instance's timers
  // cannot be trusted and failed/ambiguous transactions must never be reused.
  try{c.release(true)}finally{c.removeListener?.('error',onError);}
 }
}
export async function withScopedTransaction(fn,{pool:provided,readOnly=true}={}){
 return managedTransaction(fn,{pool:provided||await scopedPool(),readOnly,verify:verifyScopedRole});
}
export function latestExpectedDay(now=new Date()){
 const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 return new Date(Date.parse(eastern+'T12:00:00Z')-86400000).toISOString().slice(0,10);
}
export async function readScopedRows({start,end,pool}){
 return withScopedTransaction(async c=>{
 end=end||latestExpectedDay();
 // Production does not currently set the preview-only SC3_SEASON_START variable.
 // Find the first complete game day in the season containing the requested end.
 // Do not substitute an unrelated prior NBA season or treat an empty DB as complete.
 const year=Number(end.slice(0,4))-(Number(end.slice(5,7))<10?1:0);
 const boundary=year+'-10-01';
 const resolvedStart=start||(await c.query("select min(game_day)::text as start from sc3.sc3_nba_sync_days where status='complete' and game_day >= $1::date and game_day <= $2::date",[boundary,end])).rows[0]?.start;
 if(typeof resolvedStart!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(resolvedStart)||resolvedStart>end)throw Error('SC3 NBA season start unavailable');
 const days=(await c.query('select game_day::text,status,player_rows,completed_events from sc3.sc3_nba_sync_days where game_day between $1::date and $2::date order by game_day',[resolvedStart,end])).rows;
 const raw=(await c.query('select event_id,espn_id,game_day::text,tipoff::text,player_name,nba_team,stats from sc3.sc3_nba_game_logs where game_day between $1::date and $2::date order by event_id,espn_id',[resolvedStart,end])).rows;
 const identities=(await c.query("select yahoo_id,espn_id,status,evidence from sc3.sc3_player_identity where status='verified' order by yahoo_id")).rows;
 // Additional identities remain transient and are never written by read paths.
 const {readRosterIdentityInputs,rosterIdentityFallback}=await import('./sc3-roster-identity.mjs');
 const {players,catalog}=await readRosterIdentityInputs(c);
 const fallback=rosterIdentityFallback(players,identities,catalog);
 return {days,raw,identities:[...identities,...fallback],rosterIdentityCandidates:players,identityCatalog:catalog,end,start:resolvedStart};
 },{pool});
}
export function scopedSyncStore({pool}={}){
 return {async save(batch){
 if(!Array.isArray(batch.p_rows)||!Number.isInteger(batch.p_events)||batch.p_events<0||new Set(batch.p_rows.map(r=>r.event_id)).size!==batch.p_events||batch.p_rows.some(r=>r.game_day!==batch.p_day))throw Error('Invalid completed-day batch');
 return withScopedTransaction(async c=>{
 await c.query("select pg_advisory_xact_lock(hashtext('sc3-nba:'||$1))",[batch.p_day]);
 const prior=(await c.query('select observed_at from sc3.sc3_nba_sync_days where game_day=$1',[batch.p_day])).rows[0];
 if(prior&&Date.parse(prior.observed_at)>Date.parse(batch.p_observed))throw Error('Older snapshot');
 await c.query("insert into sc3.sc3_nba_sync_days(game_day,observed_at,completed_events,player_rows,status,errors) values($1,$2,$3,$4,'complete','[]'::jsonb) on conflict(game_day) do update set observed_at=excluded.observed_at,completed_events=excluded.completed_events,player_rows=excluded.player_rows,status='complete',errors='[]'::jsonb",[batch.p_day,batch.p_observed,batch.p_events,batch.p_rows.length]);
 await c.query('delete from sc3.sc3_nba_game_logs where game_day=$1',[batch.p_day]);
 const result=await c.query('insert into sc3.sc3_nba_game_logs(event_id,espn_id,game_day,tipoff,player_name,nba_team,stats,observed_at) select event_id,espn_id,game_day,tipoff,player_name,nba_team,stats,$2::timestamptz from jsonb_to_recordset($1::jsonb) as r(event_id text,espn_id text,game_day date,tipoff timestamptz,player_name text,nba_team text,stats jsonb)',[JSON.stringify(batch.p_rows),batch.p_observed]);
 if(result.rowCount!==batch.p_rows.length)throw Error('Stored count mismatch');return result.rowCount;
 },{pool,readOnly:false});
 }};
}
