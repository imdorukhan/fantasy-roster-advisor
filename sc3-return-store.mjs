import {withScopedTransaction} from './sc3-postgres.mjs';
import {forecastsFromEspn,settleReturn,sourceReliability} from './sc3-return-ledger.mjs';
// Explicit dedicated transaction injection only, never call shared sc3_app for writes.
export async function appendObservedForecasts(feed,{writerTransaction}={}){
 if(typeof writerTransaction!=='function')throw Error('Dedicated ledger writer required');
 return writerTransaction(async c=>{
  const now=(await c.query('select clock_timestamp() as now')).rows[0].now;
  const forecasts=forecastsFromEspn(feed,new Date(now).toISOString());
  let inserted=0;
  for(const f of forecasts){
   const r=await c.query(`insert into sc3.p2_return_forecasts(id,source,source_url,espn_id,report_at,feed_observed_at,estimated_date,status)
    values($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing returning id`,[f.id,f.source,f.sourceUrl,f.espnId,f.reportAt,f.feedObservedAt,f.estimatedDate,f.status]);
   inserted+=r.rowCount;
  }
  return {inserted,attempted:forecasts.length};
 });
}
const selectForecasts=`select id,source,source_url as "sourceUrl",espn_id as "espnId",report_at::text as "reportAt",feed_observed_at::text as "feedObservedAt",estimated_date::text as "estimatedDate",status,captured_at::text as "capturedAt" from sc3.p2_return_forecasts`;
const selectSettlements=`select forecast_id as "forecastId",event_id as "eventId",actual_date::text as "actualDate",actual_tipoff::text as "actualTipoff",evidence_observed_at::text as "evidenceObservedAt",settled_at::text as "settledAt" from sc3.p2_return_settlements`;
export async function appendVerifiedSettlements({writerTransaction}={}){
 if(typeof writerTransaction!=='function')throw Error('Dedicated ledger writer required');
 return writerTransaction(async c=>{
  const now=(await c.query('select clock_timestamp() as now')).rows[0].now;
  const pending=(await c.query(selectForecasts+' f where not exists(select 1 from sc3.p2_return_settlements s where s.forecast_id=f.id) order by captured_at limit 250')).rows;
  if(!pending.length)return {inserted:0,pending:0};
  const earliest=pending.map(p=>p.reportAt).sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
  const logs=(await c.query(`select event_id,espn_id,game_day::text,tipoff::text,observed_at::text,stats from sc3.sc3_nba_game_logs
   where espn_id=any($1::text[]) and tipoff>=$2::timestamptz and observed_at<=$3::timestamptz`,[[...new Set(pending.map(p=>p.espnId))],earliest,now])).rows;
  const days=(await c.query(`select d.game_day::text,d.status,d.observed_at::text,(d.player_rows=coalesce(g.rows,0) and d.completed_events=coalesce(g.events,0)) as coverage_verified
   from sc3.sc3_nba_sync_days d left join (select game_day,count(*) rows,count(distinct event_id) events from sc3.sc3_nba_game_logs group by game_day) g using(game_day)
   where d.game_day>=($1::timestamptz at time zone 'America/New_York')::date and d.observed_at<=$2::timestamptz`,[earliest,now])).rows;
  let inserted=0;
  for(const f of pending){
   const s=settleReturn(f,logs,days,new Date(now).toISOString());if(!s)continue;
   const r=await c.query(`insert into sc3.p2_return_settlements(forecast_id,event_id,actual_date,actual_tipoff,evidence_observed_at)
    values($1,$2,$3,$4,$5) on conflict do nothing returning forecast_id`,[s.forecastId,s.eventId,s.actualDate,s.actualTipoff,s.evidenceObservedAt]);
   inserted+=r.rowCount;
  }
  return {inserted,pending:pending.length-inserted};
 });
}
export async function readReturnLedger({transaction=withScopedTransaction,now=new Date()}={}){
 try{return await transaction(async c=>{
  const forecasts=(await c.query(selectForecasts+' where captured_at<=$1::timestamptz order by captured_at',[now])).rows;
  const settlements=(await c.query(selectSettlements+' where settled_at<=$1::timestamptz order by settled_at',[now])).rows;
  return {status:'READY',recorded:forecasts.length,settled:settlements.length,sources:sourceReliability(forecasts,settlements,{asOf:now}),readOnly:true};
 });}catch{return {status:'UNAVAILABLE',recorded:null,settled:null,sources:[],readOnly:true};}
}
