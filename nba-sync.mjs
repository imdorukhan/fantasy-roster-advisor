// A development-only collector. Explicit isolated Supabase ref required.
// No production fallback. No credentials appear in logs.
import {ingestGameLogs} from './nba-game-logs.mjs';
const productionRef='bmsfbcuausbfzheufjtc';
const iso=d=>d.toISOString().slice(0,10);
export function dateRange(start,end){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw Error('Invalid ISO date range');
 const a=new Date(start+'T12:00:00Z'),b=new Date(end+'T12:00:00Z');
 if(!Number.isFinite(+a)||!Number.isFinite(+b)||iso(a)!==start||iso(b)!==end||a>b)throw Error('Invalid dates');
 const days=[];for(let d=a;d<=b;d=new Date(+d+86400000)){days.push(iso(d));if(days.length>366)throw Error('Range too large')}
 return days;
}
export function batchForDay(day,result){
 if(!result.complete||!Array.isArray(result.rows)||result.requestedDates?.length!==1||result.requestedDates[0]!==day.replaceAll('-','')||!Number.isFinite(Date.parse(result.observedAt)))throw Error('Incomplete collection');
 const seen=new Set(),events=new Set();
 const rows=result.rows.map(r=>{
  if(!/^\d+$/.test(r.espnId)||!/^\d+$/.test(r.eventId)||!Number.isFinite(Date.parse(r.date)))throw Error('Bad identity or date');
  const key=r.eventId+'|'+r.espnId;if(seen.has(key))throw Error('Duplicate player-game record');seen.add(key);events.add(r.eventId);
  if(!r.stats||typeof r.stats.MIN!=='number'||r.stats.MIN<=0||Object.values(r.stats).some(v=>v!==null&&(!Number.isFinite(v)||v<0)))throw Error('Invalid stat values');
  for(const [m,a] of [['FGM','FGA'],['FTM','FTA'],['3PM','3PA']])if(r.stats[m]!=null&&r.stats[a]!=null&&r.stats[m]>r.stats[a])throw Error('Invalid shot attempts');
  return {event_id:r.eventId,espn_id:r.espnId,game_day:day,tipoff:r.date,player_name:r.name,nba_team:r.team,stats:r.stats};
 });
 if(events.size!==result.completedEvents)throw Error('Event coverage mismatch');
 return {p_day:day,p_observed:result.observedAt,p_events:events.size,p_rows:rows};
}
export function coverage(days,records){const map=new Map(records.map(r=>[r.game_day,r]));const missing=days.filter(d=>map.get(d)?.status!=='complete');return {expected:days.length,complete:days.length-missing.length,missing,ready:days.length>0&&!missing.length}}
export function devStore({url,secret,expectedRef,fetcher=fetch}){
 const u=new URL(url);if(!expectedRef||expectedRef===productionRef||u.protocol!=='https:'||u.hostname!==expectedRef+'.supabase.co'||u.pathname!=='/'||u.search||u.hash||!secret)throw Error('Explicit isolated development database required');
 return {async save(batch){const r=await fetcher(u.origin+'/rest/v1/rpc/sc3_store_completed_day',{method:'POST',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(batch),signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Development database write HTTP '+r.status);const count=await r.json();if(count!==batch.p_rows.length)throw Error('Stored count mismatch');return count;}};
}
export async function syncDays({days,store,collect=ingestGameLogs}){
 const completed=[],failed=[];
 for(const day of days)try{
  const result=await collect({dates:[day.replaceAll('-','')]});
  const batch=batchForDay(day,result);
  const count=await store.save(batch);completed.push({day,events:batch.p_events,rows:count});
 }catch(e){failed.push({day,error:String(e.message)})}
 return {completed,failed,complete:failed.length===0};
}
