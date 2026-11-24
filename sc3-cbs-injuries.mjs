import {teamCode,teams as nbaTeams} from './sc3-depth-store.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
export const CBS_SOURCE='https://www.cbssports.com/nba/injuries/';
const norm=s=>String(s??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&apos;|&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/\s+/g,' ').trim();
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const eastern=now=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function parseDate(s,reference,direction){
 const m=s.match(/^([A-Z][a-z]{2}) (\d{1,2})$/);if(!m||!months.includes(m[1]))return null;
 const y=Number(reference.slice(0,4));const candidates=[y-1,y,y+1].map(year=>year+'-'+String(months.indexOf(m[1])+1).padStart(2,'0')+'-'+m[2].padStart(2,'0')).filter(d=>Number.isFinite(Date.parse(d+'T12:00Z'))&&new Date(d+'T12:00Z').toISOString().slice(0,10)===d);
 return direction==='past'?candidates.filter(d=>d<=reference).at(-1)??null:candidates.find(d=>d>=reference)??null;
}
export function parseCBSInjuries(html,catalog,now=new Date()){
 const today=eastern(now),rows=[],teams=new Set(),seen=new Set(),ambiguous=new Set();
 if(typeof html!=='string'||!/<h1[^>]*>\s*NBA Injuries\s*<\/h1>/i.test(html))throw Error('Invalid CBS injury page');
 const lookup=new Map();
 for(const p of catalog){const k=norm(p.name)+'|'+teamCode(p.team);if(!lookup.has(k))lookup.set(k,[]);lookup.get(k).push(p);}
 let parsed=0;
 for(const table of html.matchAll(/<h4\b[^>]*class="TableBase-title[^"]*"[^>]*>([\s\S]*?)<\/h4>[\s\S]*?(<table\b[\s\S]*?<\/table>)/gi)){
  const team=teamCode(table[1].match(/href="\/nba\/teams\/([A-Z]{2,3})\//i)?.[1]?.toUpperCase()??'');
  if(!nbaTeams.includes(team)||teams.has(team))throw Error('Unverified CBS team section');teams.add(team);
  for(const tr of table[2].matchAll(/<tr\b[^>]*class="TableBase-bodyTr"[^>]*>([\s\S]*?)<\/tr>/gi)){
   const cells=[...tr[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
   if(cells.length!==5)throw Error('Invalid CBS player row');
   const name=clean(cells[0].match(/<span class="CellPlayerName--long">([\s\S]*?)<\/a>/i)?.[1]??'');
   const date=clean(cells[2]).replace(/^[A-Za-z]{3}, /,'');
   const reportDate=parseDate(date,today,'past'),status=clean(cells[4]);parsed++;
   if(!name||!reportDate||!status)continue;
   const candidates=lookup.get(norm(name)+'|'+team)??[];
   if(candidates.length!==1)continue;
   const player=candidates[0],espnId=String(player.espnId);
   if(!/^\d{1,12}$/.test(espnId))continue;
   const explicit=status.match(/^Expected to be out until at least ([A-Z][a-z]{2} \d{1,2})$/);
   const earliestReturn=explicit?parseDate(explicit[1],reportDate,'future'):null;
   if(seen.has(espnId)){ambiguous.add(espnId);continue;}seen.add(espnId);
   rows.push({espnId,name:player.name,nbaTeam:team,reportDate,observedAt:now.toISOString(),status,earliestReturn,kind:'LOWER_BOUND_NOT_POINT_ESTIMATE',source:'CBS',sourceUrl:CBS_SOURCE});
  }
 }
 if(teams.size<10||parsed<30)throw Error('CBS coverage unavailable');
 return {source:'CBS',observedAt:now.toISOString(),teamGroups:teams.size,parsed,rows:rows.filter(p=>!ambiguous.has(p.espnId)),readOnly:true};
}
export async function readCBSInjuries({fetcher=fetch,transaction=withScopedTransaction,now=new Date()}={}){
 const catalog=await transaction(async c=>(await c.query('select espn_id as "espnId",name,nba_team as team from sc3.espn_player_identity')).rows);
 const r=await fetcher(CBS_SOURCE,{redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store',headers:{'User-Agent':'Mozilla/5.0'}});
 if(!r.ok||r.redirected)throw Error('CBS source unavailable');
 return parseCBSInjuries(await r.text(),catalog,now);
}
