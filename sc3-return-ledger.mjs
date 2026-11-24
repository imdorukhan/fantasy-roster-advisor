import {createHash} from 'node:crypto';
import {ESPN_INJURY_SOURCE} from './sc3-injury-feed.mjs';
const allowedSources=new Map([['ESPN',ESPN_INJURY_SOURCE],['NBA_OFFICIAL','https://www.nba.com/players/injury-report']]);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00Z'))&&new Date(x+'T12:00Z').toISOString().slice(0,10)===x;
const ms=x=>Date.parse(x);
const iso=x=>new Date(x).toISOString();
const eastern=x=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(x));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export function returnForecast(input,capturedAt){
 const {source,sourceUrl,espnId,reportAt,feedObservedAt,estimatedDate,status}=input;
 const t=ms(capturedAt),published=ms(reportAt),feed=ms(feedObservedAt);
 // Only an explicit provider estimate, not inferred from a game-status report.
 if(!allowedSources.has(source)||sourceUrl!==allowedSources.get(source)||!/^\d{1,12}$/.test(String(espnId))||!Number.isFinite(t)||!Number.isFinite(published)||!Number.isFinite(feed)||published>feed||feed>t||t-feed>86400000||!date(estimatedDate)||estimatedDate<eastern(t)||!['out','day-to-day','doubtful','questionable'].includes(String(status).toLowerCase()))return null;
 const immutable={source,sourceUrl,espnId:String(espnId),reportAt:iso(published),feedObservedAt:iso(feed),estimatedDate,status:String(status)};
 // The same report + estimate is one forecast even when the feed refreshes.
 const id=hash([source,String(espnId),immutable.reportAt,estimatedDate]);
 return {id,...immutable,capturedAt:iso(t)};
}
export function forecastsFromEspn(feed,capturedAt){
 return [...feed.rows.values()].map(r=>returnForecast({source:'ESPN',sourceUrl:ESPN_INJURY_SOURCE,espnId:r.espnId,reportAt:r.reportAt,feedObservedAt:feed.observedAt,estimatedDate:r.reportedReturnDate,status:r.status},capturedAt)).filter(Boolean);
}
const diffDays=(a,b)=>(Date.parse(a+'T12:00Z')-Date.parse(b+'T12:00Z'))/86400000;
// First positive-minute appearance after capture; reject incomplete intervening
// game-day coverage and stale reports (a player already appeared after report).
export function settleReturn(forecast,logs,days,settledAt){
 const captured=ms(forecast.capturedAt),published=ms(forecast.reportAt),cutoff=ms(settledAt);
 if(!Number.isFinite(captured)||!Number.isFinite(published)||!Number.isFinite(cutoff)||cutoff<=captured)return null;
 const observations=logs.filter(r=>String(r.espn_id)===forecast.espnId&&Number.isFinite(ms(r.tipoff))&&Number.isFinite(ms(r.observed_at))&&ms(r.observed_at)>=ms(r.tipoff)&&ms(r.observed_at)<=cutoff&&r.stats?.MIN>0&&date(r.game_day)).sort((a,b)=>ms(a.tipoff)-ms(b.tipoff));
 if(observations.some(r=>ms(r.tipoff)>published&&ms(r.tipoff)<=captured))return null;
 const first=observations.find(r=>ms(r.tipoff)>captured);
 if(!first)return null;
 const map=new Map(days.map(d=>[d.game_day,d]));
 for(let d=eastern(published);d<=first.game_day;d=new Date(Date.parse(d+'T12:00Z')+86400000).toISOString().slice(0,10)){
  const row=map.get(d);if(!row||row.status!=='complete'||row.coverage_verified!==true||!Number.isFinite(ms(row.observed_at))||ms(row.observed_at)>cutoff)return null;
 }
 const error=diffDays(first.game_day,forecast.estimatedDate);
 return {forecastId:forecast.id,eventId:String(first.event_id),actualDate:first.game_day,actualTipoff:iso(ms(first.tipoff)),evidenceObservedAt:iso(ms(first.observed_at)),settledAt:iso(cutoff),signedErrorDays:error,absoluteErrorDays:Math.abs(error),hitWithin3:Math.abs(error)<=3,source:'ESPN completed NBA box score'};
}
export function sourceReliability(forecasts,settlements,{asOf=new Date(),minimum=10}={}){
 const cutoff=+asOf,byId=new Map(forecasts.filter(f=>ms(f.capturedAt)<=cutoff).map(f=>[f.id,f])),groups=new Map();
 // One earliest observed forecast per athlete/report episode/source; do not let
 // repeated estimate revisions multiply one injury's influence.
 const earliest=new Map();
 for(const f of byId.values()){
  const key=f.source+'|'+f.espnId+'|'+f.reportAt;
  if(!earliest.has(key)||ms(f.capturedAt)<ms(earliest.get(key).capturedAt))earliest.set(key,f);
 }
 const accepted=new Set([...earliest.values()].map(f=>f.id)),seen=new Set();
 for(const f of earliest.values())if(!groups.has(f.source))groups.set(f.source,{source:f.source,recorded:0,settled:0,absolute:0,hits:0,bias:0});
 for(const f of earliest.values())groups.get(f.source).recorded++;
 for(const s of settlements){
  const f=byId.get(s.forecastId);
  if(!f||!accepted.has(f.id)||seen.has(f.id)||ms(s.settledAt)>cutoff||ms(s.actualTipoff)<=ms(f.capturedAt)||!date(s.actualDate))continue;
  seen.add(f.id);const g=groups.get(f.source),error=diffDays(s.actualDate,f.estimatedDate);
  g.settled++;g.absolute+=Math.abs(error);g.bias+=error;g.hits+=Math.abs(error)<=3?1:0;
 }
 return [...groups.values()].map(g=>{
  const n=g.settled,p=n?g.hits/n:null,z=1.96;
  const lower=n?(p+z*z/(2*n)-z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n)))/(1+z*z/n):null;
  return {source:g.source,recorded:g.recorded,settled:n,pending:g.recorded-n,maeDays:n?g.absolute/n:null,biasDays:n?g.bias/n:null,hitWithin3:p,reliability:n>=minimum?Math.max(0,lower):null,minimum,method:'95% Wilson lower bound on ±3 day hit rate; earliest captured estimate per report'};
 }).sort((a,b)=>(b.reliability??-1)-(a.reliability??-1));
}
