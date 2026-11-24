import {createHash} from 'node:crypto';
import {withScopedTransaction} from './sc3-postgres.mjs';
import {finalMatchupFromHistory,leagueToday} from './yahoo-scoreboard.mjs';
const leagueKey='478.l.85892',myKey=leagueKey+'.t.5';
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00Z'))&&new Date(s+'T12:00Z').toISOString().slice(0,10)===s;
function fixtureFromRaw(raw){
 if(!Array.isArray(raw?.league)||!raw.league.some(x=>x?.league_key===leagueKey))return [];
 const matches=raw.league[1]?.scoreboard?.[0]?.matchups;
 if(!matches)return [];
 const out=[];
 for(const [k,v] of Object.entries(matches)){
  if(!/^\d+$/.test(k))continue;
  const m=v?.matchup,week=Number(m?.week);
  if(!Number.isInteger(week)||week<1||week>30||!day(m.week_start)||!day(m.week_end)||m.week_start>m.week_end)continue;
  const keys=Object.entries(m?.['0']?.teams??{}).filter(([k])=>/^\d+$/.test(k)).map(([,t])=>t?.team?.[0]?.find(x=>typeof x?.team_key==='string')?.team_key);
  if(keys.length!==2||new Set(keys).size!==2||!keys.includes(myKey))continue;
  const rival=keys.find(k=>k!==myKey);
  if(!/^478\.l\.85892\.t\.(?:[1-9]|1[0-4])$/.test(rival??''))continue;
  out.push({leagueId:85892,week,weekStart:m.week_start,weekEnd:m.week_end,opponentId:Number(rival.split('.t.')[1]),status:m.status??'unknown'});
 }
 return out;
}
export function historicalCoverage(rows,now=new Date()){
 const byWeek=new Map(),closed=new Map(),today=leagueToday(now);
 for(const row of rows){
  if(!Number.isFinite(Date.parse(row.observed_at))||Date.parse(row.observed_at)>+now)continue;
  for(const f of fixtureFromRaw(row.payload)){
   const key=f.week+'|'+f.weekStart+'|'+f.weekEnd+'|'+f.opponentId;
   const entry=byWeek.get(key)??{...f,observations:0,posteventCandidates:0,firstObserved:row.observed_at,lastObserved:row.observed_at};
   entry.observations++;
   if(f.status==='postevent'&&leagueToday(new Date(row.observed_at))>f.weekEnd)entry.posteventCandidates++;
   if(Date.parse(row.observed_at)<Date.parse(entry.firstObserved))entry.firstObserved=row.observed_at;
   if(Date.parse(row.observed_at)>Date.parse(entry.lastObserved))entry.lastObserved=row.observed_at;
   byWeek.set(key,entry);
   if(f.weekEnd<today)closed.set(key,f);
  }
 }
 const conflicts=new Set([...closed.values()].filter((a,i,arr)=>arr.some(b=>a.week===b.week&&(a.opponentId!==b.opponentId||a.weekStart!==b.weekStart||a.weekEnd!==b.weekEnd))).map(a=>a.week));
 return {observations:rows.length,weeks:[...byWeek.values()].sort((a,b)=>a.week-b.week),closedTargets:[...closed.values()].filter(f=>!conflicts.has(f.week)).sort((a,b)=>a.week-b.week),conflictingWeeks:[...conflicts],legacySourceVerified:false,readOnly:true};
}
export async function readHistoricalCoverage({transaction=withScopedTransaction,now=new Date()}={}){
 const data=await transaction(async c=>(await c.query("select payload,observed_at::text from sc3.yahoo_league_snapshot_history where league_id=85892 and section='scoreboard' and observed_at<=$1::timestamptz order by observed_at desc limit 500",[now])).rows);
 const result=historicalCoverage(data,now);
 try{const archive=await transaction(async c=>(await c.query("select week,opponent_id,week_start::text,week_end::text,max(observed_at)::text as last_observed,count(*)::int as observations from sc3.p2_yahoo_final_observations where league_id=85892 and observed_at<=$1::timestamptz group by week,opponent_id,week_start,week_end order by week",[now])).rows);
 return {...result,archiveStatus:'READY',verifiedFinals:archive};}catch{return {...result,archiveStatus:'UNAVAILABLE',verifiedFinals:null};}
}
export function historicalScoreboardPath(week){
 if(!Number.isInteger(week)||week<1||week>30)throw Error('Invalid Yahoo week');
 return 'league/'+leagueKey+'/scoreboard;week='+week+'?format=json';
}
// Injected authorized Yahoo READ collector only; no session or token access in this module.
export async function archiveFinalMatchups(targets,{writerTransaction,readWeek,now=()=>new Date()}={}){
 if(typeof writerTransaction!=='function'||typeof readWeek!=='function')throw Error('Dedicated writer and explicit authorized read collector required');
 const unique=new Map();
 for(const f of targets??[]){
  if(f.leagueId!==85892||!Number.isInteger(f.week)||f.week<1||f.week>30||!Number.isInteger(f.opponentId)||f.opponentId<1||f.opponentId>14||f.opponentId===5||!day(f.weekStart)||!day(f.weekEnd)||f.weekStart>f.weekEnd||f.weekEnd>=leagueToday(now()))continue;
  if(unique.has(f.week)&&JSON.stringify(unique.get(f.week))!==JSON.stringify(f))throw Error('Conflicting final week target');
  unique.set(f.week,f);
 }
 let inserted=0,verified=0;const unavailable=[];
 for(const f of [...unique.values()].sort((a,b)=>b.week-a.week).slice(0,4)){
  try{
   const raw=await readWeek(historicalScoreboardPath(f.week)),observedAt=now().toISOString();
   const official=finalMatchupFromHistory(raw,f,{observedAt,now:new Date(observedAt)});if(!official){unavailable.push(f.week);continue;}
   verified++;
   const id=createHash('sha256').update(JSON.stringify([f.leagueId,f.week,f.opponentId,f.weekStart,f.weekEnd,official.score,official.ourTeam.stats,official.opponent.stats])).digest('hex');
   const result=await writerTransaction(c=>c.query("insert into sc3.p2_yahoo_final_observations(id,league_id,week,opponent_id,week_start,week_end,observed_at,source,payload) values($1,85892,$2,$3,$4,$5,$6,'Yahoo Fantasy Sports API',$7::jsonb) on conflict do nothing returning id",[id,f.week,f.opponentId,f.weekStart,f.weekEnd,observedAt,JSON.stringify(raw)]));
   inserted+=result.rowCount;
  }catch{unavailable.push(f.week);}
 }
 return {verified,inserted,unavailable,remaining:Math.max(0,unique.size-4)};
}
export async function readVerifiedFinalArchive(c,record,now){
 const rows=(await c.query("select payload,observed_at::text from sc3.p2_yahoo_final_observations where league_id=85892 and week=$1 and opponent_id=$2 and week_start=$3::date and week_end=$4::date and source='Yahoo Fantasy Sports API' and observed_at>$5::timestamptz and observed_at<=$6::timestamptz order by observed_at desc limit 2",[record.week,record.opponentId,record.weekStart,record.weekEnd,record.asOf,now])).rows;
 for(const row of rows){const final=finalMatchupFromHistory(row.payload,record,{observedAt:row.observed_at,now});if(final)return final;}
 return null;
}
