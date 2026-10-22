// Public, read-only sources. No OAuth credentials, cookies or transactions.
export const categories=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
const clean=s=>s.replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const tables=s=>s.match(/<table\b[^>]*>[\s\S]*?<\/table>/gi)||[];
const rows=s=>s.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi)||[];
const cells=s=>(s.match(/<td\b[^>]*>[\s\S]*?<\/td>/gi)||[]).map(clean);
const number=s=>/^(?:\d+|\d*\.\d+)$/.test(s)?Number(s):null;
export function parseMatchup(html){
 const table=tables(html).find(t=>/FGM\/A/.test(t)&&/Salary CAPtain/.test(t));
 if(!table)throw Error('Yahoo category table unavailable or changed');
 const teams=rows(table).map(r=>({r,c:cells(r)})).filter(x=>x.c.length===13).map(({r,c})=>{
  const id=r.match(/\/nba\/85892\/(\d+)/)?.[1];
  const values=[c[2],c[4],...c.slice(5,12)].map(number);
  if(!id||values.some((v,i)=>v===null||v<0||(i<2&&v>1)))throw Error('Incomplete Yahoo category scores');
  return {id:Number(id),name:c[0],stats:Object.fromEntries(categories.map((k,i)=>[k,values[i]])),fieldGoals:c[1],freeThrows:c[3]};
 });
 const ours=teams.find(t=>t.id===5),opponent=teams.find(t=>t.id!==5);
 if(teams.length!==2||!ours||!opponent)throw Error('Unverified matchup identity');
 const counts=clean(html.match(/id="remaining-games"[\s\S]*?<section/)?.[0]||'').match(/(\d+) Remaining (\d+)\/(\d+) Games Played (\d+)\/(\d+) Remaining (\d+)/);
 if(counts){ours.games={played:+counts[2],total:+counts[3],remaining:+counts[1]};opponent.games={played:+counts[4],total:+counts[5],remaining:+counts[6]};}
 return {ours,opponent};
}
export function parseRoster(html,teamId){
 if(!html.includes(`/nba/85892/${teamId}`))throw Error('Yahoo roster identity missing');
 const table=tables(html).find(t=>t.includes('data-ys-playerid')&&t.includes('data-pos='));
 if(!table)throw Error('Yahoo roster table unavailable');
 const players=rows(table).filter(r=>r.includes('data-ys-playerid')).map(r=>{
  const name=r.match(/<a\b[^>]*data-ys-playerid="(\d+)"[^>]*>([\s\S]*?)<\/a>/);
  const slot=r.match(/data-pos="([^"]+)"/)?.[1];
  const club=clean(r).match(/\b([A-Z]{2,3}) - ([A-Z,]+)/);
  if(!name||!slot||!club)throw Error('Incomplete Yahoo roster row');
  return {id:name[1],name:clean(name[2]),slot,nbaTeam:club[1],positions:club[2].split(','),ownershipSource:'Yahoo public roster',liveYahooVerified:false};
 });
 if(!players.length||new Set(players.map(p=>p.id)).size!==players.length)throw Error('Invalid Yahoo roster');
 return players;
}
export function analyzeMatchup(matchup){
 let wins=0,losses=0,ties=0;
 const comparison=categories.map(category=>{const ours=matchup.ours.stats[category],theirs=matchup.opponent.stats[category];const delta=ours-theirs;const direction=category==='TO'?-1:1;const status=delta===0?'tied':delta*direction>0?'leading':'trailing';if(status==='leading')wins++;else if(status==='trailing')losses++;else ties++;return {category,ours,theirs,delta,status};});
 return {wins,losses,ties,comparison,projection:null,note:'Observed category scores only. No win probability without verified remaining lineups and projections.',executable:false};
}
export async function ingest({fetcher=fetch,now=new Date(),date}={}){
 const day=date||new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day)))throw Error('Invalid date');
 const fetchedAt=now.toISOString(),sources=[];
 async function load(source,url,json=false){try{const r=await fetcher(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(12000),redirect:'error'});if(!r.ok)throw Error(`HTTP ${r.status}`);const data=json?await r.json():await r.text();sources.push({source,url,fetchedAt,status:'retrieved'});return data;}catch(e){sources.push({source,url,fetchedAt,status:'unavailable',reason:e.message});return null;}}
 function invalid(source,e){const record=sources.find(s=>s.source===source);record.status='invalid';record.reason=e.message;}
 const [html,roster,nba,espn]=await Promise.all([
 load('Yahoo matchup','https://basketball.fantasysports.yahoo.com/nba/85892/matchup?mid1=5'),
 load('Yahoo team 5','https://basketball.fantasysports.yahoo.com/nba/85892/5'),
 load('NBA.com schedule','https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json',true),
 load('ESPN scoreboard',`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day.replaceAll('-','')}`,true)
 ]);
 let matchup=null,ours=null,opponent=null;
 try{if(html)matchup=parseMatchup(html);}catch(e){invalid('Yahoo matchup',e);}
 try{if(roster)ours=parseRoster(roster,5);}catch(e){invalid('Yahoo team 5',e);}
 if(matchup){const name='Yahoo opponent';const other=await load(name,`https://basketball.fantasysports.yahoo.com/nba/85892/${matchup.opponent.id}`);try{if(other)opponent=parseRoster(other,matchup.opponent.id);}catch(e){invalid(name,e);}}
 let schedule=null,crossCheck='unavailable';
 const nbaGames=nba?.leagueSchedule?.gameDates?.flatMap(d=>d.games||[]);
 const espnGames=espn?.events;
 const validGames=Array.isArray(espnGames)&&espnGames.every(e=>e.id&&e.date&&e.competitions?.[0]?.competitors?.length===2);
 if(espn&&!validGames)invalid('ESPN scoreboard',Error('Unexpected scoreboard schema'));
 if(nba&&!Array.isArray(nbaGames))invalid('NBA.com schedule',Error('Unexpected schedule schema'));
 if(validGames){schedule=espnGames.map(e=>({id:e.id,date:e.date,name:e.name,status:e.status?.type?.name,teams:e.competitions[0].competitors.map(c=>c.team.abbreviation),scores:e.status?.type?.name==='STATUS_SCHEDULED'?null:e.competitions[0].competitors.map(c=>({team:c.team.abbreviation,score:c.score})),source:'ESPN scoreboard'}));crossCheck=Array.isArray(nbaGames)?(schedule.every(e=>nbaGames.some(g=>Number(g.gameId)===Number(e.id)||[g.homeTeam?.teamTricode,g.awayTeam?.teamTricode].sort().join()===e.teams.slice().sort().join()&&Math.abs(Date.parse(g.gameDateTimeUTC)-Date.parse(e.date))<60000))?'corroborated':'conflict'):'single-source';}
 else if(Array.isArray(nbaGames)){schedule=nbaGames.filter(g=>g.gameDateTimeUTC&&new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(g.gameDateTimeUTC))===day).map(g=>({id:g.gameId,date:g.gameDateTimeUTC,teams:[g.awayTeam.teamTricode,g.homeTeam.teamTricode],source:'NBA.com schedule'}));crossCheck='single-source';}
 return {schemaVersion:1,leagueId:85892,teamId:5,fetchedAt,date:day,status:matchup?'observed':'unavailable',matchup,analysis:matchup?analyzeMatchup(matchup):null,rosters:{ours,opponent},schedule,crossCheck,sources,limitations:['Public pages may lag and category scores may be corrected.','Public roster observation is not OAuth ownership/FA/waiver verification.','No prior snapshot is substituted for failed current retrieval.','NBA and ESPN cannot establish Yahoo fantasy ownership.'],executable:false};
}
