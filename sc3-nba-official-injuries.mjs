import {createHash} from 'node:crypto';
import {teamCode,teams as nbaTeams} from './sc3-depth-store.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
export const NBA_INJURY_INDEX='https://www.nba.com/players/injury-report';
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
 for(const page of pages){
  const lines=pageLines(page);
  const header=lines.find(l=>/^Injury Report:/.test(l.all));
  const h=header?.all.match(/^Injury Report:\s*(\d{1,2})\/(\d{1,2})\/(\d{2})\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if(!h||easternStamp(2000+Number(h[3]),+h[1],+h[2],+h[4],+h[5],h[6])!==publishedAt)throw Error('NBA report title mismatch');
  const tableHeader=lines.find(l=>l.all.includes('Game Date')&&l.all.includes('Player Name')&&l.all.includes('Current Status'));
  if(!tableHeader)throw Error('NBA report table header missing');
  for(const l of lines.filter(x=>x.y<tableHeader.y&&!/^Page \d+ of \d+$/.test(x.all))){
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
   rows.push({espnId,name:candidates[0].name,nbaTeam:club,gameDate,status,reason,source:'NBA_OFFICIAL',sourceUrl:url,publishedAt,observedAt,kind:'GAME_STATUS_NOT_RETURN_ESTIMATE'});
  }
 }
 if(!teamGroups.size||(!parsed&&!notSubmitted.length))throw Error('NBA report coverage unavailable');
 return {source:'NBA_OFFICIAL',url,publishedAt,observedAt,parsed,matched:rows.length,unmatched,teamGroups:teamGroups.size,notSubmitted,rows,readOnly:true};
}
export async function extractOfficialPages(bytes){
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true,disableFontFace:true});
 try{
  const doc=await task.promise;if(doc.numPages<1||doc.numPages>30)throw Error('Invalid NBA report page count');
  const pages=[];
  for(let i=1;i<=doc.numPages;i++){const p=await doc.getPage(i);pages.push({width:p.view[2]-p.view[0],items:(await p.getTextContent()).items});}
  return pages;
 }finally{await task.destroy();}
}
export async function readOfficialInjuries({fetcher=fetch,transaction=withScopedTransaction,now,extract=extractOfficialPages}={}){
 const catalog=await transaction(async c=>(await c.query('select espn_id as "espnId",name,nba_team as team from sc3.espn_player_identity')).rows);
 const index=await fetcher(NBA_INJURY_INDEX,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store',headers:{'User-Agent':'Mozilla/5.0'}});
 if(!index.ok||index.redirected)throw Error('NBA report index unavailable');
 const selected=selectOfficialReport(await index.text(),now??new Date());if(!selected)throw Error('Fresh official report unavailable');
 const r=await fetcher(selected.url,{redirect:'error',signal:AbortSignal.timeout(10000),cache:'no-store'});
 if(!r.ok||r.redirected||Number(r.headers.get('content-length')??0)>4*1024*1024)throw Error('NBA PDF unavailable');
 const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>4*1024*1024||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Invalid NBA PDF');
 const observedAt=(now??new Date()).toISOString();
 const report=parseOfficialPages(await extract(bytes),catalog,{...selected,observedAt});
 return {...report,documentDigest:createHash('sha256').update(bytes).digest('hex')};
}
