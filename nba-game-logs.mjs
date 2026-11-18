// ESPN completed NBA game logs, never fantasy lineup appearances.
export const COUNT_KEYS=['PTS','REB','AST','STL','BLK','TO','FGM','FGA','FTM','FTA','3PM','3PA','OREB','DREB','PF','MIN'];
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:typeof x==='string'&&/^(?:\d+|\d+\.\d+)$/.test(x.trim())?Number(x):null;
const pair=x=>{const m=String(x??'').match(/^(\d+)-(\d+)$/);return m&&+m[1]<=+m[2]?[+m[1],+m[2]]:[null,null]};
const min=x=>{const m=String(x??'').match(/^(\d+):([0-5]\d)$/);return m?+m[1]+ +m[2]/60:num(x)};
export function parseBoxScore(summary,event){
 if(event?.status?.type?.completed!==true||!event.id||!event.date)return [];
 const rows=[];
 for(const team of summary?.boxscore?.players||[])for(const section of team.statistics||[]){
  const labels=section.labels;
  if(!Array.isArray(labels))continue;
  for(const a of section.athletes||[]){
   if(a.didNotPlay===true||!a.athlete?.id||!Array.isArray(a.stats)||a.stats.length!==labels.length)continue;
   const x=Object.fromEntries(labels.map((k,i)=>[k,a.stats[i]]));
   const minutes=min(x.MIN);if(minutes===null||minutes<=0)continue;
   const [FGM,FGA]=pair(x.FG),[FTM,FTA]=pair(x.FT),[three,threeA]=pair(x['3PT']);
   const values={MIN:minutes,FGM,FGA,FTM,FTA,'3PM':three,'3PA':threeA};
   for(const k of ['PTS','REB','AST','STL','BLK','TO','OREB','DREB','PF'])values[k]=num(x[k]);
   rows.push({espnId:String(a.athlete.id),name:a.athlete.displayName||a.athlete.fullName||null,team:team.team?.abbreviation||null,eventId:String(event.id),date:event.date,stats:values,source:'ESPN completed NBA box score'});
  }
 }
 return [...new Map(rows.map(r=>[r.espnId+'|'+r.eventId,r])).values()];
}
const time=x=>Date.parse(x.date);
export function gameWindows(logs,{asOf=new Date(),windows=[1,3,7,14]}={}){
 const rows=[...new Map(logs.filter(x=>Number.isFinite(time(x))&&time(x)<=asOf.getTime()).map(x=>[x.eventId,x])).values()].sort((a,b)=>time(b)-time(a));
 if(new Set(rows.map(r=>r.espnId)).size>1)throw Error('Mixed player IDs');
 return Object.fromEntries(windows.map(n=>{
  const games=rows.slice(0,n),values={},totals={};
  for(const k of COUNT_KEYS){const all=games.map(g=>g.stats?.[k]);totals[k]=games.length&&all.every(v=>typeof v==='number'&&Number.isFinite(v))?all.reduce((a,b)=>a+b,0):null;values[k==='MIN'?'MPG':k]=totals[k]===null?null:totals[k]/games.length}
  for(const [k,m,a] of [['FG%','FGM','FGA'],['FT%','FTM','FTA'],['3P%','3PM','3PA']])values[k]=totals[m]!==null&&totals[a]>0?totals[m]/totals[a]:null;
  return [String(n),{requested:n,games:games.length,complete:games.length===n,values,totals,latest:games[0]?.date||null,earliest:games.at(-1)?.date||null}];
 }));
}
export function performanceTrend(windows,seasonValues){
 return Object.fromEntries(Object.entries(windows).map(([n,w])=>[n,{games:w.games,complete:w.complete,delta:Object.fromEntries(Object.entries(w.values).map(([k,v])=>[k,w.complete&&Number.isFinite(v)&&Number.isFinite(seasonValues?.[k])?v-seasonValues[k]:null]))}]));
}
export async function ingestGameLogs({dates,fetcher=fetch,concurrency=4}){
 if(!Array.isArray(dates)||dates.length>14||dates.some(d=>!/^\d{8}$/.test(d)))throw Error('Provide up to 14 YYYYMMDD dates');
 const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
 const errors=[],events=new Map(),rows=[];
 async function load(url){const r=await fetcher(url,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error('HTTP '+r.status);return r.json()}
 for(const date of [...new Set(dates)])try{const d=await load(BASE+'scoreboard?dates='+date);if(!Array.isArray(d.events))throw Error('Invalid scoreboard');for(const e of d.events){
 if(e.season&&Number(e.season.type)!==2)continue;
 if(e.status?.type?.completed===true&&e.id)events.set(String(e.id),e);
 else if(!['STATUS_POSTPONED','STATUS_CANCELED','STATUS_CANCELLED'].includes(e.status?.type?.name))errors.push({date,eventId:e.id||null,error:'Game not final or status missing'});
 }}catch(e){errors.push({date,error:e.message})}
 const list=[...events.values()],size=Math.max(1,Math.min(5,concurrency));
 for(let i=0;i<list.length;i+=size)await Promise.all(list.slice(i,i+size).map(async e=>{try{const data=await load(BASE+'summary?event='+encodeURIComponent(e.id));const parsed=parseBoxScore(data,e);if(!parsed.length)throw Error('No valid player rows');rows.push(...parsed)}catch(err){errors.push({eventId:e.id,error:err.message})}}));
 return {source:'ESPN NBA',observedAt:new Date().toISOString(),requestedDates:[...new Set(dates)],completedEvents:list.length,rows,errors,complete:errors.length===0};
}
