import {createHash} from 'node:crypto';
import {appendObservedForecasts,appendVerifiedSettlements} from './sc3-return-store.mjs';
import {appendMatchup,appendMatchupSettlements} from './sc3-matchup-ledger.mjs';
import {finalMatchupFromHistory} from './yahoo-scoreboard.mjs';
import {CBS_SOURCE} from './sc3-cbs-injuries.mjs';
export async function appendCBSObservations(feed,{writerTransaction}={}){
 if(typeof writerTransaction!=='function')throw Error('Dedicated writer required');
 if(feed?.source!=='CBS'||!Array.isArray(feed.rows))return {inserted:0};
 return writerTransaction(async c=>{
  const now=(await c.query('select clock_timestamp() now')).rows[0].now;
  const age=+now-Date.parse(feed.observedAt);
  if(!Number.isFinite(age)||age<0||age>300000)throw Error('Stale CBS evidence');
  let inserted=0;
  for(const row of feed.rows){
   if(row.source!=='CBS'||row.sourceUrl!==CBS_SOURCE||row.kind!=='LOWER_BOUND_NOT_POINT_ESTIMATE'||row.observedAt!==feed.observedAt)throw Error('Invalid CBS observation');
   const id=createHash('sha256').update(JSON.stringify([row.espnId,row.reportDate,row.status,row.earliestReturn])).digest('hex');
   const r=await c.query('insert into sc3.p2_cbs_observations(id,espn_id,report_date,earliest_return,observed_at,payload) values($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing returning id',[id,row.espnId,row.reportDate,row.earliestReturn,row.observedAt,JSON.stringify(row)]);inserted+=r.rowCount;
  }
  return {inserted};
 });
}
export async function readVerifiedFinal(c,record,now){
 const rows=(await c.query("select payload,observed_at::text from sc3.yahoo_league_snapshot_history where league_id=85892 and section='scoreboard' and source='Yahoo Fantasy Sports API' and observed_at>$1::timestamptz and observed_at<=$2::timestamptz order by observed_at desc limit 100",[record.asOf,now])).rows;
 for(const row of rows){const final=finalMatchupFromHistory(row.payload,record,{observedAt:row.observed_at,now});if(final)return final;}
 return null;
}
// No default DB writer, no scheduler registration, no production route.
// An explicitly isolated runner supplies both collectors and its dedicated writer.
export async function runP21Cycle({writerTransaction,collectESPN,collectCBS,collectMatchup,readFinal=readVerifiedFinal}={}){
 if(typeof writerTransaction!=='function')throw Error('Dedicated writer required');
 if([collectESPN,collectCBS,collectMatchup].some(f=>typeof f!=='function'))throw Error('Explicit collectors required');
 const observations=await Promise.allSettled([collectESPN(),collectCBS(),collectMatchup()]);
 const out={};
 for(const [i,key] of ['espn','cbs','matchup'].entries()){
  const r=observations[i];
  if(r.status!=='fulfilled'||!r.value){out[key]={status:'UNAVAILABLE'};continue;}
  try{
   const result=i===0?await appendObservedForecasts(r.value,{writerTransaction}):i===1?await appendCBSObservations(r.value,{writerTransaction}):await appendMatchup(r.value,r.value.projection?.forecast,{writerTransaction});
   out[key]={status:'COMPLETE',...result};
  }catch{out[key]={status:'FAILED'};}
 }
 for(const [key,fn] of [['returnSettlement',()=>appendVerifiedSettlements({writerTransaction})],['matchupSettlement',()=>appendMatchupSettlements({writerTransaction,readFinal})]]){
  try{out[key]={status:'COMPLETE',...await fn()};}catch{out[key]={status:'FAILED'};}
 }
 return out;
}
