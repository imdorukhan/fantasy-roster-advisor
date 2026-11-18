import {syncDays,dateRange} from './nba-sync.mjs';
import {latestExpectedDay,scopedSyncStore,withScopedTransaction} from './sc3-postgres.mjs';
export async function dailySync({start=process.env.SC3_SEASON_START,now=new Date(),pool,collect}={}){
 const end=latestExpectedDay(now),days=dateRange(start,end);
 const complete=await withScopedTransaction(async c=>new Set((await c.query("select game_day::text from sc3.sc3_nba_sync_days where status='complete' and game_day between $1 and $2",[start,end])).rows.map(r=>r.game_day)),{pool});
 const targets=[...new Set([...days.filter(d=>!complete.has(d)),...days.slice(-3)])].sort().slice(0,7);
 const result=await syncDays({days:targets,store:scopedSyncStore({pool}),...(collect?{collect}:{})});
 return {complete:result.complete,completed:result.completed,failed:result.failed.map(x=>({day:x.day,error:'Collection or storage failed'})),end,targets};
}
