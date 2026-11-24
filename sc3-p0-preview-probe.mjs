import {fetchScheduleSource,upcomingTeams} from './sc3-streaming-plan.mjs';
import {ingestGameLogs} from './nba-game-logs.mjs';
import {batchForDay} from './nba-sync.mjs';
import {latestExpectedDay} from './sc3-postgres.mjs';
import {leagueToday} from './yahoo-scoreboard.mjs';

export async function p0PreviewProbe(req,res,{env=process.env,now=new Date(),fetcher=fetch,collect=ingestGameLogs}={}){
 res.setHeader('Cache-Control','private, no-store');
 if(env.VERCEL_ENV!=='preview'||env.SC3_P0_PREVIEW_PROBE!=='1')return res.status(404).json({error:'Not found'});
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const start=leagueToday(now),dates=Array.from({length:6},(_,i)=>new Date(Date.parse(start+'T12:00Z')+i*86400000).toISOString().slice(0,10));
 const days=[];
 const base='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=';
 for(const day of dates){
  try{const j=await fetchScheduleSource(base+day.replaceAll('-',''),'json',fetcher);const s=upcomingTeams(j,day,now);days.push({day,games:s.gameCount,verified:true});}
  catch{days.push({day,verified:false});}
 }
 const expected=latestExpectedDay(now);
 let history;
 try{const result=await collect({dates:[expected.replaceAll('-','')],fetcher});const batch=batchForDay(expected,result);history={day:expected,verified:true,events:batch.p_events,rows:batch.p_rows.length};}
 catch{history={day:expected,verified:false};}
 const complete=days.every(d=>d.verified)&&history.verified;
 return res.status(complete?200:503).json({mode:'SC3_P0_PREVIEW_PROBE',complete,days,history,snapshotWrites:0,readOnly:true});
}
