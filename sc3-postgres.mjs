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
  return {host,port:5432,database:'postgres',user,password,ssl:{ca:supabaseRoots,rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeoutMillis:10000,statement_timeout:20000,max:2};
 }
 // These error labels describe only the public connection envelope.
 if(!/^postgres(?:ql)?:\/\//.test(raw))throw Error('SC3 database URL scheme missing');
 if(!approved.some(({user})=>raw.startsWith('postgresql://'+user+':')||raw.startsWith('postgres://'+user+':')))throw Error('SC3 database URL role mismatch');
 throw Error('SC3 database URL endpoint mismatch');
}
let pool;
export async function scopedPool(){if(!pool){const config=pgConfig();const {Pool}=await import('pg');pool=new Pool(config)}return pool}
export async function withScopedTransaction(fn,{pool:provided,readOnly=true}={}){
 const p=provided||await scopedPool(),c=await p.connect();
 try{await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');await c.query("SET LOCAL search_path TO pg_catalog, sc3");
 const check=await c.query("select current_user as role, session_user as login, has_schema_privilege(current_user,'sc3','USAGE') as allowed, exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') and (has_table_privilege(current_user,c.oid,'SELECT') or has_table_privilege(current_user,c.oid,'INSERT') or has_table_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE'))) as legacy_access");
 const row=check.rows[0];if(row?.role!=='sc3_app'||row.login!=='sc3_app'||row.allowed!==true||row.legacy_access!==false)throw Error('Scoped role verification failed');
 const result=await fn(c);await c.query('COMMIT');return result;
 }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{
  // Serverless instances may freeze before idle pool timers fire. Return the SC3 role slot immediately.
  if(!provided&&process.env.VERCEL==='1')c.release(true);
  else c.release();
 }
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
 return {days,raw,identities,end,start:resolvedStart};
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
