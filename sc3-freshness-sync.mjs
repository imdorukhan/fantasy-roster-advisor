import {dateRange,batchForDay} from './nba-sync.mjs';
import {ingestGameLogs} from './nba-game-logs.mjs';
import {latestExpectedDay,scopedSyncStore,withScopedTransaction} from './sc3-postgres.mjs';
import {authorized} from './sc3-yahoo-full-sync.mjs';
import {currentMatchupIdentityFromScoreboard,currentMatchupCategoryCoverage} from './yahoo-scoreboard.mjs';

// Recent gaps first, bounded by the serverless runtime. Never declare a
// complete season merely because the selected subset succeeded.
export function historyRefreshPlan({start,end,completeDays,limit=3}){
 const expected=dateRange(start,end);
 const complete=new Set(completeDays);
 const missing=expected.filter(d=>!complete.has(d));
 const targets=missing.slice(-limit).reverse();
 return {start,end,missing,targets,remaining:missing.length-targets.length};
}
export async function readHistoryPlan({now=new Date(),transaction=withScopedTransaction}={}){
 const end=latestExpectedDay(now);
 const boundary=(Number(end.slice(0,4))-(Number(end.slice(5,7))<10?1:0))+'-10-01';
 return transaction(async c=>{
  const rows=(await c.query("select game_day::text,status from sc3.sc3_nba_sync_days where game_day between $1::date and $2::date order by game_day",[boundary,end])).rows;
  const start=rows.find(r=>r.status==='complete')?.game_day;
  if(!start)throw Error('Season baseline unavailable');
  return historyRefreshPlan({start,end,completeDays:rows.filter(r=>r.status==='complete').map(r=>r.game_day)});
 });
}
export async function nbaHistoryCron(req,res,{env=process.env,now=new Date(),plan=readHistoryPlan,collect=ingestGameLogs,save=batch=>scopedSyncStore({}).save(batch),log=console.info}={}){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req,env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
 if(env.VERCEL_ENV!=='production'||env.SC3_SHARED_DB!=='1'||env.SC3_NBA_HISTORY_CRON_ENABLED!=='1')return res.status(404).json({error:'Sync disabled'});
 const write=env.SC3_NBA_HISTORY_CRON_WRITE==='1';
 let stage='plan',attempted=false;
 const saved=[],validated=[];
 const finish=(http,body)=>{const result={mode:'SC3_NBA_HISTORY_CRON',stage,validated,saved,snapshotWrites:attempted?null:saved.length,...body};log('SC3_NBA_HISTORY_CRON '+JSON.stringify(result));return res.status(http).json(result)};
 try{
  const p=await plan({now});stage='collect';
  const batches=[];
  for(const day of p.targets){
   const result=await collect({dates:[day.replaceAll('-','')]});
   const batch=batchForDay(day,result);batches.push(batch);validated.push({day,events:batch.p_events,rows:batch.p_rows.length});
  }
  if(!write)return finish(200,{status:'VALIDATED',complete:p.remaining===0,missingAfterValidation:p.remaining,expectedEnd:p.end,snapshotWrites:0});
  stage='save';
  for(const batch of batches){attempted=true;await save(batch);attempted=false;saved.push(batch.p_day);}
  stage='verify';
  const after=await plan({now});
  return finish(after.missing.length?503:200,{status:after.missing.length?'INCOMPLETE':'PASS',complete:!after.missing.length,expectedEnd:after.end,missing:after.missing,snapshotWrites:saved.length});
 }catch{return finish(503,{status:'FAILED',complete:false,category:'nba_history_'+stage+'_failed'});}
}

const leagueKey='478.l.85892';
const source='Yahoo Fantasy Sports API';
export function verifyScoreboardObservation(raw,observedAt,now=new Date()){
 if(!Array.isArray(raw?.league)||!raw.league.some(v=>v?.league_key===leagueKey))throw Error('League mismatch');
 const opts={observedAt,now};
 const identity=currentMatchupIdentityFromScoreboard(raw,opts);
 const categoryCoverage=currentMatchupCategoryCoverage(raw,opts);
 return {week:identity.week,opponentId:identity.opponent.id,publishedCount:categoryCoverage.publishedCount,noAttemptCategories:categoryCoverage.noAttemptCategories};
}
// Share the full-sync advisory lock. Store only the scoreboard section with
// its actual observation time; never stamp other snapshots as refreshed.
export async function saveScoreboardObservation(raw,observedAt,{transaction=withScopedTransaction,now=new Date()}={}){
 const summary=verifyScoreboardObservation(raw,observedAt,now);
 return transaction(async c=>{
  await c.query('select pg_advisory_xact_lock(85892, 3)');
  const result=await c.query(`with saved as (
   insert into sc3.yahoo_league_snapshots(league_id,section,payload,observed_at,source)
   values(85892,'scoreboard',$1::jsonb,$2::timestamptz,$3)
   on conflict(league_id,section) do update set payload=excluded.payload,observed_at=excluded.observed_at,source=excluded.source
   where sc3.yahoo_league_snapshots.observed_at<excluded.observed_at
   returning league_id,section,payload,observed_at
  ), history as (
   insert into sc3.yahoo_league_snapshot_history(league_id,section,payload,observed_at)
   select league_id,section,payload,observed_at from saved returning section
  ) select (select count(*)::int from saved) as snapshots,(select count(*)::int from history) as history`,[JSON.stringify(raw),observedAt,source]);
  const counts=result.rows[0];
  if(counts?.snapshots!==1||counts.history!==1)throw Error('Scoreboard observation not committed');
  return summary;
 },{readOnly:false});
}
export async function verifyScoreboardWrite(raw,observedAt,{transaction=withScopedTransaction}={}){
 return transaction(async c=>{
  const result=await c.query(`select exists(select 1 from sc3.yahoo_league_snapshots s join sc3.yahoo_league_snapshot_history h using(league_id,section,observed_at)
   where s.league_id=85892 and s.section='scoreboard' and s.source=$3 and s.observed_at=$2::timestamptz and s.payload=$1::jsonb and h.payload=s.payload) as verified`,[JSON.stringify(raw),observedAt,source]);
  if(result.rows[0]?.verified!==true)throw Error('Scoreboard readback failed');
  return true;
 });
}
export async function yahooScoreboardCron(req,res,{env=process.env,now=()=>new Date(),readScoreboard,save=saveScoreboardObservation,verify=verifyScoreboardWrite,log=console.info}={}){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!authorized(req,env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
 if(env.VERCEL_ENV!=='production'||env.SC3_SHARED_DB!=='1'||env.SC3_SCOREBOARD_CRON_ENABLED!=='1')return res.status(404).json({error:'Sync disabled'});
 let stage='collect',committed=false,attempted=false;
 const finish=(http,body)=>{const result={mode:'SC3_SCOREBOARD_CRON',stage,committed,snapshotWrites:committed?1:attempted?null:0,...body};log('SC3_SCOREBOARD_CRON '+JSON.stringify(result));return res.status(http).json(result)};
 try{
  const raw=await readScoreboard();
  const instant=now(),observedAt=instant.toISOString();
  stage='validate';
  const summary=verifyScoreboardObservation(raw,observedAt,instant);
  if(env.SC3_SCOREBOARD_CRON_WRITE!=='1')return finish(200,{status:'VALIDATED',observedAt,...summary});
  stage='save';attempted=true;
  try{await save(raw,observedAt,{now:instant});committed=true;attempted=false;}
  catch{await verify(raw,observedAt);committed=true;attempted=false;}
  stage='verify';await verify(raw,observedAt);
  return finish(200,{status:'PASS',observedAt,...summary});
 }catch{return finish(503,{status:'FAILED',category:'scoreboard_'+stage+'_failed'});}
}
