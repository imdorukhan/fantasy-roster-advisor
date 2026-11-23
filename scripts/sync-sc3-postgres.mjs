import {syncDays,dateRange} from '../nba-sync.mjs';
import {scopedSyncStore,scopedPool} from '../sc3-postgres.mjs';
const now=new Date();
const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
const yesterday=new Date(Date.parse(eastern+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const start=process.env.SC3_SEASON_START;
const pool=await scopedPool();
try {
 const days=dateRange(start,yesterday);
 const {rows}=await pool.query("select game_day::text from sc3.sc3_nba_sync_days where status='complete' and game_day between $1 and $2",[start,yesterday]);
 const complete=new Set(rows.map(r=>r.game_day));
 const missing=days.filter(d=>!complete.has(d));
 const refresh=days.slice(-3);
 const targets=[...new Set([...missing,...refresh])].sort();
 const result=await syncDays({days:targets,store:scopedSyncStore({pool})});
 console.log(JSON.stringify(result));if(!result.complete)process.exitCode=1;
}finally{await pool.end()}
