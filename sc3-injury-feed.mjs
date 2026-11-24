import {teamCode,teams as nbaTeams} from './sc3-depth-store.mjs';
export const ESPN_INJURY_SOURCE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries';
const norm=x=>String(x??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const dateOnly=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00Z'))&&new Date(x+'T12:00Z').toISOString().slice(0,10)===x;
const athleteId=athlete=>{
 const ids=new Set();
 if(/^\d{1,12}$/.test(String(athlete?.id??'')))ids.add(String(athlete.id));
 for(const link of athlete?.links??[]){
  if(!link?.rel?.includes('playercard')||typeof link.href!=='string')continue;
  const m=link.href.match(/^https:\/\/www\.espn\.com\/nba\/player\/_\/id\/(\d{1,12})(?:\/[^/?#]*)?\/?$/);
  if(m)ids.add(m[1]);
 }
 return ids.size===1?[...ids][0]:null;
};
export function parseEspnInjuryFeed(data,now=new Date()){
 const observedAt=data?.timestamp,stamp=Date.parse(observedAt),time=now.getTime();
 const season=now.getUTCFullYear()+(now.getUTCMonth()>=9?1:0);
 if(data?.status!=='success'||Number(data.season?.year)!==season||Number(data.season?.type)!==2||
  !Number.isFinite(stamp)||stamp>time+60_000||time-stamp>24*3600_000||!Array.isArray(data.injuries))throw Error('ESPN injury feed unavailable');
 const teams=new Set(),byId=new Map(),ambiguous=new Set();
 for(const team of data.injuries){
  if(!/^\d+$/.test(String(team?.id??''))||teams.has(String(team.id))||!Array.isArray(team.injuries))throw Error('ESPN injury team coverage invalid');
  teams.add(String(team.id));
  for(const injury of team.injuries){
   const athlete=injury?.athlete,id=athleteId(athlete);
   const nbaTeam=teamCode(athlete?.team?.abbreviation??'');
   const reportAt=injury?.date,reportTime=Date.parse(reportAt);
   if(!id||!norm(athlete?.displayName)||!nbaTeams.includes(nbaTeam)||String(athlete?.team?.id)!==String(team.id)||
      !Number.isFinite(reportTime)||reportTime>time+60_000||typeof injury.status!=='string'||!injury.status.trim())continue;
   if(byId.has(id)){ambiguous.add(id);continue;}
   const reported=injury.details?.returnDate;
   // Provider estimates are not medical clearance or confirmed return dates.
   const returnDate=dateOnly(reported)?reported:null;
   byId.set(id,{espnId:id,name:athlete.displayName,nbaTeam,status:injury.status.slice(0,60),reportAt,
    reportedReturnDate:returnDate,returnDatePassed:returnDate!==null&&returnDate<now.toISOString().slice(0,10),
    injuryType:typeof injury.details?.type==='string'?injury.details.type.slice(0,80):null,
    shortComment:typeof injury.shortComment==='string'?injury.shortComment.slice(0,500):null,
    sourceUrl:'https://www.espn.com/nba/player/_/id/'+id+'/',feedObservedAt:observedAt});
  }
 }
 for(const id of ambiguous)byId.delete(id);
 return {observedAt,teamGroups:teams.size,rows:byId};
}
export function attachInjuryReports(roster,identities,feed){
 const links=new Map();
 const conflict=new Set();
 for(const row of identities){
  const id=String(row.yahoo_id);
  if(row.status!=='verified'||!/^\d{1,12}$/.test(String(row.espn_id)))continue;
  if(links.has(id)&&links.get(id)!==String(row.espn_id))conflict.add(id);
  links.set(id,String(row.espn_id));
 }
 return roster.map(p=>{
  const key=String(p.yahooId),report=conflict.has(key)?null:feed?.rows.get(links.get(key));
  const matched=report&&norm(report.name)===norm(p.name)&&report.nbaTeam===teamCode(p.nbaTeam??'');
  return {...p,espnReport:matched?report:null};
 });
}
export async function fetchEspnInjuryFeed({now=new Date(),fetcher=fetch}={}){
 const response=await fetcher(ESPN_INJURY_SOURCE,{redirect:'error',signal:AbortSignal.timeout(7000),cache:'no-store'});
 if(!response.ok||response.redirected)throw Error('ESPN injury source unavailable');
 return parseEspnInjuryFeed(await response.json(),now);
}
