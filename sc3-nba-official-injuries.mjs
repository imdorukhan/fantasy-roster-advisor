import {createHash} from 'node:crypto';
import {teamCode,teams as nbaTeams} from './sc3-depth-store.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
export const NBA_INJURY_INDEX='https://www.nba.com/players/injury-report';
export function officialIndexUrls(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric'}).formatToParts(now).map(p=>[p.type,p.value]));
 const year=Number(parts.year)-(Number(parts.month)<10?1:0);
 return ['https://official.nba.com/nba-injury-report-'+year+'-'+String(year+1).slice(-2)+'-season/',NBA_INJURY_INDEX];
}
const pattern=/^https:\/\/(?:ak-static\.cms|official)\.nba\.com\/referee\/injury\/Injury-Report_(\d{4})-(\d{2})-(\d{2})_(\d{2})_(\d{2})(AM|PM)\.pdf$/;
const statusSet=new Set(['Out','Doubtful','Questionable','Probable','Available']);
const normalize=s=>String(s??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const fullTeams={'Atlanta Hawks':'ATL','Boston Celtics':'BOS','Brooklyn Nets':'BKN','Charlotte Hornets':'CHA','Chicago Bulls':'CHI','Cleveland Cavaliers':'CLE','Dallas Mavericks':'DAL','Denver Nuggets':'DEN','Detroit Pistons':'DET','Golden State Warriors':'GS','Houston Rockets':'HOU','Indiana Pacers':'IND','LA Clippers':'LAC','Los Angeles Clippers':'LAC','Los Angeles Lakers':'LAL','Memphis Grizzlies':'MEM','Miami Heat':'MIA','Milwaukee Bucks':'MIL','Minnesota Timberwolves':'MIN','New Orleans Pelicans':'NO','New York Knicks':'NY','Oklahoma City Thunder':'OKC','Orlando Magic':'ORL','Philadelphia 76ers':'PHI','Phoenix Suns':'PHX','Portland Trail Blazers':'POR','Sacramento Kings':'SAC','San Antonio Spurs':'SA','Toronto Raptors':'TOR','Utah Jazz':'UTA','Washington Wizards':'WSH'};
const isoDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T12:00Z'))&&new Date(s+'T12:00Z').toISOString().slice(0,10)===s;
function easternStamp(y,m,d,h,min,ap){
 if(h<1||h>12||min>59)return null;
 const hour=h%12+(ap==='PM'?12:0),target=[y,m,d,hour,min].map(Number);
 const base=Date.UTC(y,m-1,d,hour,min);
 // Resolve actual US Eastern offset, including DST; reject ambiguous/nonexistent times.
 const fmt=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'numeric',day:'numeric',hour:'numeric',minute:'numeric',hourCycle:'h23'});
 const matches=[4,5].map(off=>base+off*3600000).filter(t=>{const p=Object.fromEntries(fmt.formatToParts(new Date(t)).map(v=>[v.type,v.value]));return [p.year,p.month,p.day,p.hour,p.minute].map(Number).every((v,i)=>v===target[i]);});
 return matches.length===1?new Date(matches[0]).toISOString():null;
}
export function officialPublication(url){
 const m=String(url).match(pattern);if(!m)return null;
 const [,y,mo,d,h,min,ap]=m;
 if(!isoDate(y+'-'+mo+'-'+d))return null;
 return easternStamp(+y,+mo,+d,+h,+min,ap);
}
export function selectOfficialReport(html,now=new Date()){
 const urls=[...new Set(String(html).match(/https:\/\/(?:ak-static\.cms|official)\.nba\.com\/referee\/injury\/Injury-Report_\d{4}-\d{2}-\d{2}_\d{2}_\d{2}(?:AM|PM)\.pdf/g)??[])];
 return urls.map(url=>({url,publishedAt:officialPublication(url)})).filter(v=>v.publishedAt&&Date.parse(v.publishedAt)<=+now&&+now-Date.parse(v.publishedAt)<=86400000).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt))[0]??null;
}
function pageLines(page){
 if(!Number.isFinite(page.width)||page.width<600||page.width>1300)throw Error('Unexpected PDF geometry');
 const scale=842/page.width,groups=[];
 for(const item of page.items){
  if(!item.str?.trim()||!Array.isArray(item.transform))continue;
  const x=item.transform[4]*scale,y=item.transform[5]*scale;
  if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('Invalid PDF coordinates');
  let g=groups.find(g=>Math.abs(g.y-y)<=2);if(!g){g={y,items:[]};groups.push(g);}
  g.items.push({x,str:item.str.trim()});
 }
 return groups.sort((a,b)=>b.y-a.y).map(g=>{
  const cells=Array.from({length:7},()=>[]);
  for(const v of g.items.sort((a,b)=>a.x-b.x)){
   const col=[110,190,255,415,575,655].filter(x=>v.x>=x).length;
   cells[col].push(v.str);
  }
  return {y:g.y,all:g.items.map(i=>i.str).join(' '),cells:cells.map(c=>c.join(' '))};
 });
}
export function parseOfficialPages(pages,catalog,{url,publishedAt,observedAt}){
 if(!Array.isArray(pages)||!pages.length||pages.length>30||officialPublication(url)!==publishedAt||!Number.isFinite(Date.parse(observedAt))||Date.parse(publishedAt)>Date.parse(observedAt)||Date.parse(observedAt)-Date.parse(publishedAt)>86400000)throw Error('Invalid NBA report provenance');
 const lookup=new Map();
 for(const p of catalog){const key=normalize(p.name)+'|'+teamCode(p.team);if(!lookup.has(key))lookup.set(key,[]);lookup.get(key).push(p);}
 const rows=[],notSubmitted=[],matchedKeys=new Set(),teamGroups=new Set();let gameDate=null,matchup=null,club=null,parsed=0,unmatched=0;
 for(const [index,page] of pages.entries()){
  const lines=pageLines(page);
  const header=lines.find(l=>/^Injury Report:/.test(l.all));
  const h=header?.all.match(/^Injury Report:\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if(!h||easternStamp(2000+Number(h[3]),+h[1],+h[2],+h[4],+h[5],h[6])!==publishedAt)throw Error('NBA report title mismatch');
  const tableHeader=lines.find(l=>l.all.includes('Game Date')&&l.all.includes('Player Name')&&l.all.includes('Current Status'));
  if(index===0&&!tableHeader)throw Error('NBA report table header missing');
  const footer=lines.find(l=>/^Page \d+ of \d+$/.test(l.all));
  if(footer?.all!=='Page '+(index+1)+' of '+pages.length)throw Error('NBA report page sequence mismatch');
  // The real PDF repeats the report title, but omits column headers on continuation pages.
  for(const l of lines.filter(x=>x.y<(tableHeader?.y??header.y)&&x.y>footer.y)){
   const [date,,game,team,player,status,reason]=l.cells;
   if(date){
    const m=date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)throw Error('NBA game date format changed');
    gameDate=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');if(!isoDate(gameDate))throw Error('Invalid NBA game date');
   }
   if(game){const m=game.match(/^([A-Z]{2,3})@([A-Z]{2,3})$/);if(!m)throw Error('NBA matchup format changed');matchup=[teamCode(m[1]),teamCode(m[2])];if(matchup.some(t=>!nbaTeams.includes(t))||matchup[0]===matchup[1])throw Error('Unknown NBA matchup');club=null;}
   if(team){club=fullTeams[team];if(!club||!matchup?.includes(club)||!gameDate)throw Error('Unknown report team');teamGroups.add(gameDate+'|'+club);}
   if(/NOT YET SUBMITTED/i.test(l.all)){if(!gameDate||!club)throw Error('Unverified non-submission');notSubmitted.push({gameDate,nbaTeam:club});continue;}
   if(!status&&!player)continue; // wrapped reason text only
   if(!statusSet.has(status)||!player||!gameDate||!club)throw Error('NBA report row format changed');
   const comma=player.indexOf(',');if(comma<1)throw Error('Unknown NBA player name format');
   const name=player.slice(comma+1).trim()+' '+player.slice(0,comma).trim();
   parsed++;
   const candidates=lookup.get(normalize(name)+'|'+club)??[];
   if(candidates.length!==1){unmatched++;continue;}
   const espnId=String(candidates[0].espnId),key=espnId+'|'+gameDate;
   if(!/^\d{1,12}$/.test(espnId)||matchedKeys.has(key))throw Error('Duplicate NBA report identity');
   matchedKeys.add(key);
   rows.push({espnId,name:candidates[0].name,nbaTeam:club,gameDate,status,reasonExcerpt:reason||null,source:'NBA_OFFICIAL',sourceUrl:url,publishedAt,observedAt,kind:'GAME_STATUS_NOT_RETURN_ESTIMATE'});
  }
 }
 if(!teamGroups.size||(!parsed&&!notSubmitted.length))throw Error('NBA report coverage unavailable');
 return {source:'NBA_OFFICIAL',url,publishedAt,observedAt,parsed,matched:rows.length,unmatched,teamGroups:teamGroups.size,notSubmitted,rows,readOnly:true};
}
export async function extractOfficialPages(bytes){
 // unpdf ships its serverless PDF.js build, including the worker, without
 // requiring native canvas just to extract text. Never render the PDF.
 const {getDocumentProxy}=await import('unpdf');
 const doc=await getDocumentProxy(new Uint8Array(bytes),{isEvalSupported:false,useSystemFonts:false,disableFontFace:true,maxImageSize:1000000});
 try{
  if(doc.numPages<1||doc.numPages>30)throw Error('Invalid NBA report page count');
  const pages=[];
  for(let i=1;i<=doc.numPages;i++){
   const p=await doc.getPage(i),items=(await p.getTextContent()).items;
   if(items.length>15000)throw Error('NBA report page text limit exceeded');
   pages.push({width:p.view[2]-p.view[0],items});
  }
  return pages;
 }finally{await doc.loadingTask.destroy();}
}
async function boundedBody(response,limit){
 const length=Number(response.headers?.get('content-length')??0);
 if(!response.ok||response.redirected||length>limit)throw Error('NBA source response unavailable');
 const reader=response.body?.getReader();
 if(!reader){const b=new Uint8Array(await response.arrayBuffer());if(b.length>limit)throw Error('NBA source size limit exceeded');return b;}
 const chunks=[];let total=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>limit){await reader.cancel();throw Error('NBA source size limit exceeded');}chunks.push(value);
  }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export async function discoverOfficialReport({fetcher=fetch,now}={}){
 const urls=officialIndexUrls(now??new Date());
 const results=await Promise.allSettled(urls.map(async indexUrl=>{
  const r=await fetcher(indexUrl,{redirect:'error',signal:AbortSignal.timeout(8000),cache:'no-store',headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok||r.redirected)throw Error('NBA report index unavailable');
  const html=new TextDecoder().decode(await boundedBody(r,8*1024*1024));
  return {indexUrl,selected:selectOfficialReport(html,now??new Date())};
 }));
 const accessible=results.filter(r=>r.status==='fulfilled').map(r=>r.value);
 if(!accessible.length)throw Error('NBA report index unavailable');
 const candidates=accessible.filter(r=>r.selected).sort((a,b)=>Date.parse(b.selected.publishedAt)-Date.parse(a.selected.publishedAt));
 if(!candidates.length)throw Error('Fresh official report unavailable');
 return {...candidates[0].selected,indexUrl:candidates[0].indexUrl,indexCoverage:accessible.length};
}
export async function readOfficialInjuries({fetcher=fetch,transaction=withScopedTransaction,now,extract=extractOfficialPages,catalog:providedCatalog}={}){
 const [catalog,selected]=await Promise.all([
  providedCatalog??transaction(async c=>(await c.query('select espn_id as "espnId",name,nba_team as team from sc3.espn_player_identity')).rows),
  discoverOfficialReport({fetcher,now})
 ]);
 const r=await fetcher(selected.url,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
 if(!r.ok||r.redirected||Number(r.headers.get('content-length')??0)>4*1024*1024)throw Error('NBA PDF unavailable');
 const bytes=await boundedBody(r,4*1024*1024);
 if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Invalid NBA PDF');
 const observedAt=(now??new Date()).toISOString();
 const report=parseOfficialPages(await extract(bytes),catalog,{...selected,observedAt});
 return {...report,indexUrl:selected.indexUrl,indexCoverage:selected.indexCoverage,documentDigest:createHash('sha256').update(bytes).digest('hex')};
}
