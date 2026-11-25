import {settleReturn} from './sc3-return-ledger.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
const day=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00Z'))&&new Date(s+'T12:00Z').toISOString().slice(0,10)===s;
const eastern=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'numeric',minute:'numeric',hourCycle:'h23'});
function startOfReportDate(d){
 if(!day(d))return null;
 for(const hour of [4,5]){
  const t=Date.parse(d+'T'+String(hour).padStart(2,'0')+':00:00Z');
  const parts=Object.fromEntries(fmt.formatToParts(new Date(t)).map(v=>[v.type,v.value]));
  if(eastern(t)===d&&Number(parts.hour)===0&&Number(parts.minute)===0)return new Date(t).toISOString();
 }
 return null;
}
export function settleCBSObservation(observation,logs,days,settledAt){
 const {id,espnId,reportDate,earliestReturn,observedAt,capturedAt}=observation;
 if(!id||!/^\d{1,12}$/.test(String(espnId))||!day(reportDate)||!day(earliestReturn)||!Number.isFinite(Date.parse(capturedAt))||!Number.isFinite(Date.parse(observedAt))||Date.parse(observedAt)>Date.parse(capturedAt)||reportDate>eastern(observedAt)||earliestReturn<eastern(capturedAt))return null;
 // CBS publishes a report date, not a precise publication time. Conservatively
 // reject an appearance at any point on that report date before capture.
 const reportAt=startOfReportDate(reportDate);if(!reportAt)return null;
 const s=settleReturn({id,espnId:String(espnId),reportAt,capturedAt,estimatedDate:earliestReturn},logs,days,settledAt);
 if(!s)return null;
 return {observationId:id,eventId:s.eventId,actualDate:s.actualDate,actualTipoff:s.actualTipoff,evidenceObservedAt:s.evidenceObservedAt,settledAt:s.settledAt,boundViolated:s.signedErrorDays<0,daysBeforeBound:Math.max(0,-s.signedErrorDays),daysAfterBound:Math.max(0,s.signedErrorDays)};
}
export function cbsBoundMetrics(observations,settlements,{asOf=new Date(),minimum=10}={}){
 const cutoff=+asOf,byId=new Map(observations.filter(o=>day(o.earliestReturn)&&Number.isFinite(Date.parse(o.capturedAt))&&Date.parse(o.capturedAt)<=cutoff&&o.earliestReturn>=eastern(o.capturedAt)).map(o=>[o.id,o]));
 const seen=new Set(),episodes=new Map();
 for(const s of settlements){
  const o=byId.get(s.observationId);
  if(!o||seen.has(o.id)||!Number.isFinite(Date.parse(s.settledAt))||Date.parse(s.settledAt)>cutoff||!Number.isFinite(Date.parse(s.actualTipoff))||Date.parse(s.actualTipoff)<=Date.parse(o.capturedAt)||!s.eventId||!day(s.actualDate))continue;
  seen.add(o.id);
  const key=o.espnId+'|'+s.eventId;
  if(!episodes.has(key)||Date.parse(o.capturedAt)<Date.parse(episodes.get(key).o.capturedAt))episodes.set(key,{o,s});
 }
 const errors=[...episodes.values()].map(({o,s})=>(Date.parse(s.actualDate+'T12:00Z')-Date.parse(o.earliestReturn+'T12:00Z'))/86400000);
 const n=errors.length,violations=errors.filter(x=>x<0).length,p=n?(n-violations)/n:null,z=1.96;
 const lower=n?(p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n):null;
 return {eligibleObservations:byId.size,settledObservations:seen.size,pending:byId.size-seen.size,independentReturnEvents:n,violations,violationRate:n?violations/n:null,meanDaysEarly:n?errors.reduce((a,b)=>a+Math.max(0,-b),0)/n:null,meanDaysAfterBound:n?errors.reduce((a,b)=>a+Math.max(0,b),0)/n:null,boundAdherenceLower95:n>=minimum?Math.max(0,lower):null,minimum,method:'One-sided lower bound; earliest captured observation per realized return event. Pending cases are not counted as correct.'};
}
const selectObservations='select id,espn_id as "espnId",report_date::text as "reportDate",earliest_return::text as "earliestReturn",observed_at::text as "observedAt",captured_at::text as "capturedAt" from sc3.p2_cbs_observations where earliest_return is not null';
export async function appendCBSSettlements({writerTransaction}={}){
 if(typeof writerTransaction!=='function')throw Error('Dedicated writer required');
 return writerTransaction(async c=>{
  const now=(await c.query('select clock_timestamp() now')).rows[0].now;
  const pending=(await c.query(selectObservations+" and earliest_return>=(captured_at at time zone 'America/New_York')::date and not exists(select 1 from sc3.p2_cbs_settlements s where s.observation_id=p2_cbs_observations.id) order by captured_at limit 250")).rows;
  if(!pending.length)return {inserted:0,pending:0};
  const earliest=pending.map(p=>p.reportDate).sort()[0],ids=[...new Set(pending.map(p=>p.espnId))];
  const logs=(await c.query("select event_id,espn_id,game_day::text,tipoff::text,observed_at::text,stats from sc3.sc3_nba_game_logs where espn_id=any($1::text[]) and game_day>=$2::date and observed_at<=$3::timestamptz",[ids,earliest,now])).rows;
  const days=(await c.query("select d.game_day::text,d.status,d.observed_at::text,(d.player_rows=coalesce(g.rows,0) and d.completed_events=coalesce(g.events,0)) as coverage_verified from sc3.sc3_nba_sync_days d left join (select game_day,count(*) rows,count(distinct event_id) events from sc3.sc3_nba_game_logs where game_day>=$1::date group by game_day) g using(game_day) where d.game_day>=$1::date and d.observed_at<=$2::timestamptz",[earliest,now])).rows;
  let inserted=0;
  for(const o of pending){
   const s=settleCBSObservation(o,logs,days,new Date(now).toISOString());if(!s)continue;
   const r=await c.query('insert into sc3.p2_cbs_settlements(observation_id,event_id,actual_date,actual_tipoff,evidence_observed_at) values($1,$2,$3,$4,$5) on conflict do nothing returning observation_id',[s.observationId,s.eventId,s.actualDate,s.actualTipoff,s.evidenceObservedAt]);inserted+=r.rowCount;
  }
  return {inserted,pending:pending.length-inserted};
 });
}
export async function readCBSBoundMetrics({transaction=withScopedTransaction,now=new Date()}={}){
 try{return await transaction(async c=>{
  const observations=(await c.query(selectObservations+' and captured_at<=$1::timestamptz',[now])).rows;
  const settlements=(await c.query('select observation_id as "observationId",event_id as "eventId",actual_date::text as "actualDate",actual_tipoff::text as "actualTipoff",settled_at::text as "settledAt" from sc3.p2_cbs_settlements where settled_at<=$1::timestamptz',[now])).rows;
  return {status:'READY',...cbsBoundMetrics(observations,settlements,{asOf:now}),readOnly:true};
 });}catch{return {status:'UNAVAILABLE',independentReturnEvents:null,violationRate:null,readOnly:true};}
}
