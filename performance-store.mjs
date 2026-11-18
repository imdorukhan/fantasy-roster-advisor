import {buildPerformance} from './player-performance.mjs';
import {dateRange,coverage} from './nba-sync.mjs';
import {readScopedRows} from './sc3-postgres.mjs';
// Read only from an explicitly isolated Supabase project. Never use production env.
export async function readPerformance({url,secret,expectedRef,start,end,fetcher=fetch,scoped=false,pool}={}){
 if(scoped){const data=await readScopedRows({start,pool});const expected=dateRange(start,data.end);const complete=new Set(data.days.filter(d=>d.status==='complete').map(d=>d.game_day));const missing=expected.filter(d=>!complete.has(d));const first=expected.findIndex(d=>!complete.has(d));if(first===0)throw Error('Incomplete NBA history');const contiguous=first<0?expected:expected.slice(0,first);const actualEnd=contiguous.at(-1);const result=summarize(data.days.filter(d=>d.game_day<=actualEnd),data.raw.filter(d=>d.game_day<=actualEnd),data.identities,start,actualEnd,contiguous);return {...result,expectedEnd:data.end,missingDays:missing,fresh:missing.length===0};}
 const days=dateRange(start,end);
 const u=new URL(url);
 if(!expectedRef||expectedRef==='bmsfbcuausbfzheufjtc'||u.hostname!==expectedRef+'.supabase.co'||u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||!secret)throw Error('Isolated performance database not configured');
 async function read(table,params){
 const rows=[];for(let offset=0;offset<100000;offset+=500){
 const q=new URLSearchParams({...params,limit:'500',offset:String(offset)});
 const r=await fetcher(u.origin+'/rest/v1/'+table+'?'+q,{headers:{apikey:secret,Authorization:'Bearer '+secret},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Performance store HTTP '+r.status);
 const batch=await r.json();if(!Array.isArray(batch))throw Error('Invalid performance response');
 rows.push(...batch);if(batch.length<500)return rows;
 }throw Error('Performance store pagination exceeded');
 }
 const dayRows=await read('sc3_nba_sync_days',{select:'game_day,status,player_rows,completed_events',and:'(game_day.gte.'+start+',game_day.lte.'+end+')',order:'game_day.asc'});
 const raw=await read('sc3_nba_game_logs',{select:'event_id,espn_id,game_day,tipoff,player_name,nba_team,stats',and:'(game_day.gte.'+start+',game_day.lte.'+end+')',order:'event_id.asc,espn_id.asc'});
 const identities=await read('sc3_player_identity',{select:'yahoo_id,espn_id,status,evidence',status:'eq.verified',order:'yahoo_id.asc'});
 return summarize(dayRows,raw,identities,start,end,days);
}
function summarize(dayRows,raw,identities,start,end,days){
 if(!coverage(days,dayRows).ready)throw Error('Incomplete NBA history');
 const counts=new Map();
 for(const r of raw){if(!counts.has(r.game_day))counts.set(r.game_day,{rows:0,events:new Set()});const c=counts.get(r.game_day);c.rows++;c.events.add(r.event_id)}
 if(dayRows.some(d=>Number(d.player_rows)!==(counts.get(d.game_day)?.rows||0)||Number(d.completed_events)!==(counts.get(d.game_day)?.events.size||0)))throw Error('Stored game-log coverage mismatch');
 const logs=raw.map(r=>({espnId:r.espn_id,eventId:r.event_id,date:r.tipoff,name:r.player_name,team:r.nba_team,stats:r.stats}));
 const asOf=new Date(Date.parse(end+'T12:00:00Z')+36*3600000).toISOString();
 const report=buildPerformance(logs,{asOf,historyComplete:true});
 if(!report.available)throw Error('Performance report unavailable');
 const links=new Map(identities.filter(i=>i.status==='verified'&&i.yahoo_id&&i.espn_id).map(i=>[String(i.yahoo_id),String(i.espn_id)]));
 return {report,links,historyEnd:end};
}
