import {createHash} from 'node:crypto';
import {NINE_CAT,categoryComparison} from './decision-core.mjs';
const ms=x=>Date.parse(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(ms(x+'T12:00Z'))&&new Date(x+'T12:00Z').toISOString().slice(0,10)===x;
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const distribution=p=>p&&['win','tie','loss'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=1)&&Math.abs(p.win+p.tie+p.loss-1)<1e-8;
export function matchupRecord(report,forecast,now){
 const captured=ms(now),asOf=ms(forecast?.asOf),baseline=ms(forecast?.baselineObservedAt);
 if(!forecast?.available||forecast.conditional!==true||forecast.calibrated!==false||!report?.complete||report.teams?.length!==2||report.teams[0].id!==5||!Number.isInteger(report.teams[1].id)||report.teams[1].id===5||!Number.isInteger(report.week)||!day(report.weekStart)||!day(report.weekEnd)||report.weekStart>report.weekEnd||!Number.isFinite(captured)||!Number.isFinite(asOf)||!Number.isFinite(baseline)||baseline>asOf||asOf>captured||captured-asOf>300000||!day(forecast.historyThrough)||!forecast.modelVersion||!Array.isArray(forecast.scenarios)||!forecast.scenarios.length)return null;
 if(forecast.scenarios.some(s=>!distribution(s.matchup)||s.categories?.length!==9||new Set(s.categories.map(c=>c.category)).size!==9||s.categories.some(c=>!NINE_CAT.includes(c.category)||!distribution(c))))return null;
 const payload={leagueId:85892,teamId:5,opponentId:report.teams[1].id,week:report.week,weekStart:report.weekStart,weekEnd:report.weekEnd,modelVersion:forecast.modelVersion,asOf:forecast.asOf,baselineObservedAt:forecast.baselineObservedAt,historyThrough:forecast.historyThrough,inputsDigest:forecast.inputsDigest??null,scenarios:forecast.scenarios,coverage:forecast.coverage,simulations:forecast.simulations,seed:forecast.seed,conditional:true,calibrated:false};
 if(!/^[a-f0-9]{64}$/.test(payload.inputsDigest??''))return null;
 return {id:digest(payload),...payload};
}
export function settleMatchup(record,official,now){
 if(official?.source!=='Yahoo Fantasy Sports API'||official.finalVerified!==true||official.leagueId!==85892||official.week!==record.week||official.weekStart!==record.weekStart||official.weekEnd!==record.weekEnd||official.ourTeam?.id!==5||official.opponent?.id!==record.opponentId||!Number.isFinite(ms(official.observedAt))||ms(official.observedAt)<=ms(record.asOf)||ms(official.observedAt)>ms(now))return null;
 const comparison=categoryComparison(official.ourTeam.stats,official.opponent.stats);
 if(!comparison.verified||['ours','opponent','ties'].some(k=>comparison.score[k]!==official.score?.[k]))return null;
 const actual=Object.fromEntries(comparison.rows.map(r=>[r.category,r.leader==='OURS'?'win':r.leader==='TIE'?'tie':'loss']));
 return {forecastId:record.id,observedAt:official.observedAt,actual,score:comparison.score,matchup:comparison.score.ours>comparison.score.opponent?'win':comparison.score.ours===comparison.score.opponent?'tie':'loss'};
}
export async function appendMatchup(report,forecast,{writerTransaction}={}){
 if(typeof writerTransaction!=='function')throw Error('Dedicated writer required');
 return writerTransaction(async c=>{
  const now=(await c.query('select clock_timestamp() now')).rows[0].now;
  const row=matchupRecord(report,forecast,new Date(now).toISOString());if(!row)return {inserted:0,reason:'Unverified forecast'};
  const r=await c.query('insert into sc3.p2_matchup_forecasts(id,league_id,week,opponent_id,week_start,week_end,model_version,forecast_as_of,baseline_observed_at,history_through,inputs_digest,payload) values($1,85892,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) on conflict do nothing returning id',[row.id,row.week,row.opponentId,row.weekStart,row.weekEnd,row.modelVersion,row.asOf,row.baselineObservedAt,row.historyThrough,row.inputsDigest,JSON.stringify(row)]);
  return {inserted:r.rowCount,id:row.id};
 });
}
export async function appendMatchupSettlements({writerTransaction,readFinal}={}){
 if(typeof writerTransaction!=='function'||typeof readFinal!=='function')throw Error('Dedicated writer and verified final reader required');
 return writerTransaction(async c=>{
  const now=(await c.query('select clock_timestamp() now')).rows[0].now;
  const rows=(await c.query('select f.payload from sc3.p2_matchup_forecasts f where not exists(select 1 from sc3.p2_matchup_settlements s where s.forecast_id=f.id) and f.week_end < (clock_timestamp() at time zone \'America/Los_Angeles\')::date order by f.forecast_as_of limit 250')).rows;
  let inserted=0;for(const {payload} of rows){
   const official=await readFinal(c,payload,now);const outcome=settleMatchup(payload,official,new Date(now).toISOString());if(!outcome)continue;
   const r=await c.query('insert into sc3.p2_matchup_settlements(forecast_id,final_observed_at,outcome) values($1,$2,$3::jsonb) on conflict do nothing returning forecast_id',[payload.id,outcome.observedAt,JSON.stringify(outcome)]);inserted+=r.rowCount;
  }
  return {inserted,pending:rows.length-inserted};
 });
}
