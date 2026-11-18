// Only explicit scoped credentials; never reuse a Supabase service-role key.
const ref='bmsfbcuausbfzheufjtc';
export function pgConfig(env=process.env){
 if(env.SC3_SHARED_DB!=='1')throw Error('Shared SC3 database is not enabled');
 const u=new URL(env.SC3_DATABASE_URL||'invalid:');
 const user=decodeURIComponent(u.username);
 const direct=u.hostname==='db.'+ref+'.supabase.co'&&user==='sc3_app';
 const pooled=u.hostname==='aws-0-us-west-1.pooler.supabase.com'&&user==='sc3_app.'+ref;
 if(!['postgres:','postgresql:'].includes(u.protocol)||!(direct||pooled)||!u.password||u.pathname!=='/postgres'||u.search||u.hash||!(u.port===''||u.port==='5432'))throw Error('Invalid scoped PostgreSQL connection');
 return {host:u.hostname,port:5432,database:'postgres',user,password:decodeURIComponent(u.password),ssl:{rejectUnauthorized:true},connectionTimeoutMillis:10000,statement_timeout:20000,max:2};
}
let pool;
export async function scopedPool(){if(!pool){const config=pgConfig();const {Pool}=await import('pg');pool=new Pool(config)}return pool}
export async function withScopedTransaction(fn,{pool:provided,readOnly=true}={}){
 const p=provided||await scopedPool(),c=await p.connect();
 try{await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');await c.query("SET LOCAL search_path TO pg_catalog, sc3");
 const check=await c.query("select current_user as role, session_user as login, has_schema_privilege(current_user,'sc3','USAGE') as allowed, exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') and (has_table_privilege(current_user,c.oid,'SELECT') or has_table_privilege(current_user,c.oid,'INSERT') or has_table_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE'))) as legacy_access");
 const row=check.rows[0];if(row?.role!=='sc3_app'||row.login!=='sc3_app'||row.allowed!==true||row.legacy_access!==false)throw Error('Scoped role verification failed');
 const result=await fn(c);await c.query('COMMIT');return result;
 }catch(e){try{await c.query('ROLLBACK')}catch{}throw e}finally{c.release()}
}
export async function readScopedRows({start,end,pool}){
 return withScopedTransaction(async c=>{
 const days=(await c.query('select game_day::text,status,player_rows,completed_events from sc3.sc3_nba_sync_days where game_day between $1::date and $2::date order by game_day',[start,end])).rows;
 const raw=(await c.query('select event_id,espn_id,game_day::text,tipoff::text,player_name,nba_team,stats from sc3.sc3_nba_game_logs where game_day between $1::date and $2::date order by event_id,espn_id',[start,end])).rows;
 const identities=(await c.query("select yahoo_id,espn_id,status,evidence from sc3.sc3_player_identity where status='verified' order by yahoo_id")).rows;
 return {days,raw,identities};
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
