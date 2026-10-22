// Automated, public-source-only roster and NBA schedule reader.
// No Yahoo OAuth, cookies, credentials, side effects or fantasy transactions.
const YAHOO='https://basketball.fantasysports.yahoo.com/nba/85892/';
const ESPN='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=';
const decode=s=>String(s).replace(/&amp;/g,'&').replace(/&nbsp;|&#160;/g,' ').replace(/&#(\d+);/g,(_,d)=>String.fromCharCode(Number(d))).replace(/&quot;/g,'"').replace(/&#39;/g,"'");
const strip=s=>decode(String(s||'').replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();
const safeDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s);
const localDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const days=(start,n)=>Array.from({length:n},(_,i)=>{const d=new Date(start+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10)});
export function parseYahooRoster(html,expectedTeamId){
 const table=String(html).match(/<table\b[^>]*id=["']statTable0["'][^>]*>[\s\S]*?<\/table>/i)?.[0];
 if(!table)throw Error('Yahoo roster table not present');
 const body=table.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1];
 if(!body)throw Error('Yahoo roster body absent');
 const result=[];
 for(const m of body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  const row=m[1],nameMatch=row.match(/<a\b[^>]*class=["'][^"']*\bname\b[^"']*["'][^>]*data-ys-playerid=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if(!nameMatch)continue; // Empty slot rows are allowed.
  const pos=row.match(/data-pos=["']([^"']+)["']/i)?.[1]||'UNKNOWN';
  const team= row.match(/<span\s+class=["']Fz-xxs["']>\s*([A-Z]{2,3})\s*-\s*([^<]+)<\/span>/i);
  const name=strip(nameMatch[2]);
  if(!name||!/^\d+$/.test(nameMatch[1]))continue;
  result.push({yahooId:nameMatch[1],name,slot:pos,nbaTeam:team?.[1]||null,nbaPosition:team?.[2]?.trim()||null});
 }
 if(result.length<8||result.length>20||new Set(result.map(p=>p.yahooId)).size!==result.length)throw Error('Roster parsing failed integrity checks');
 return {teamId:expectedTeamId,players:result};
}
async function get(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),9000);try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'text/html,application/json','User-Agent':'Mozilla/5.0'}});if(!r.ok)throw Error('HTTP '+r.status);return r}finally{clearTimeout(t)}}
export async function buildAutoData({start=localDay(),length=7}={}){
 if(!safeDay(start)||length<1||length>10)throw Error('Invalid schedule range');
 const results=await Promise.allSettled([get(YAHOO+'5').then(r=>r.text()),get(YAHOO+'13').then(r=>r.text())]);
 const errors=[];const rosters=[];
 for(let i=0;i<2;i++){
  try{if(results[i].status!=='fulfilled')throw Error('Yahoo fetch failed');rosters.push(parseYahooRoster(results[i].value,i===0?5:13))}
  catch(e){rosters.push(null);errors.push({section:i===0?'our roster':'opponent roster',reason:e.message})}
 }
 const dates=days(start,length);
 const fetched=await Promise.allSettled(dates.map(d=>get(ESPN+d.replaceAll('-','')).then(r=>r.json())));
 const schedule=[];let datesFetched=0;
 fetched.forEach((entry,i)=>{
  if(entry.status!=='fulfilled'){errors.push({section:'NBA schedule '+dates[i],reason:'ESPN fetch failed'});return}
  datesFetched++;
  for(const game of entry.value.events||[]){
   const comps=game.competitions?.[0]?.competitors||[];
   const teams=comps.map(x=>x.team?.abbreviation).filter(Boolean);
   if(teams.length!==2)continue;
   schedule.push({date:dates[i],teams,status:game.status?.type?.name||'UNKNOWN',completed:game.status?.type?.completed===true,espnEventId:String(game.id)});
  }
 });
 const next=(roster)=>roster?.players.map(p=>({...p,scheduledGames:p.nbaTeam?schedule.filter(g=>g.teams.includes(p.nbaTeam)&&!g.completed).map(g=>({date:g.date,opponent:g.teams.find(t=>t!==p.nbaTeam),eventId:g.espnEventId})):[]}))||[];
 return {mode:'PUBLIC_READ_ONLY',observedAt:new Date().toISOString(),sourceLinks:{yahooOurRoster:YAHOO+'5',yahooOpponentRoster:YAHOO+'13',espn:'https://www.espn.com/nba/schedule'},teams:[{id:5,name:'Salary CAPtain',players:next(rosters[0])},{id:13,name:'Sabanoglu Saban',players:next(rosters[1])}],window:{start,end:dates.at(-1),days:length},schedule,coverage:{yahooOurRoster:!!rosters[0],yahooOpponentRoster:!!rosters[1],espnDatesFetched:datesFetched,espnDatesRequested:length},errors,notes:['Public Yahoo roster may reflect a different selected date or locked lineup; verify current status from source','Upcoming NBA games are schedule opportunities, not guaranteed active fantasy starts','No free agents or add/drop recommendations are inferred without verified ownership']};
}
export default async function handler(req,res){
 try{const result=await buildAutoData();res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=600');res.status(200).json(result)}
 catch(e){res.setHeader('Cache-Control','no-store');res.status(503).json({error:'Automatic public sources unavailable',reason:String(e.message)})}
}
