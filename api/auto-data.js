import {cookies,configured,tokenRequest} from './auth/yahoo/_lib.js';
import {loadSession,saveSession,storeConfigured} from './auth/yahoo/_store.js';
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
 if(req.query?.live==='1')return liveHandler(req,res);
 try{const result=await buildAutoData();res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=600');res.status(200).json(result)}
 catch(e){res.setHeader('Cache-Control','no-store');res.status(503).json({error:'Automatic public sources unavailable',reason:String(e.message)})}
}



const BASE='https://fantasysports.yahooapis.com/fantasy/v2/';
const response=(res,status,body)=>{res.setHeader('Cache-Control','private, no-store');return res.status(status).json(body)};
async function read(token,path){
 const r=await fetch(BASE+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw Object.assign(Error('Yahoo Fantasy API rejected request'),{status:r.status});
 const j=await r.json();if(!j.fantasy_content)throw Error('Invalid Yahoo Fantasy response');return j.fantasy_content;
}
function findTeams(node,out=[],depth=0){
 if(!node||typeof node!=='object'||depth>18)return out;
 if(Array.isArray(node)){
  const key=node.find(x=>x&&typeof x==='object'&&typeof x.team_key==='string')?.team_key;
  if(key){const name=node.find(x=>x&&typeof x==='object'&&typeof x.name==='string')?.name||null;out.push({key,name})}
  for(const v of node)findTeams(v,out,depth+1);
 }else for(const v of Object.values(node))findTeams(v,out,depth+1);
 return out;
}
function rawPlayerSample(node,playerId,depth=0){
 if(!node||typeof node!=='object'||depth>24)return null;
 if(Array.isArray(node)){
  const meta=node.find(x=>Array.isArray(x)&&x.some(y=>y&&typeof y==='object'&&String(y.player_id||'')===playerId));
  if(meta)return node;
  if(node.some(x=>x&&typeof x==='object'&&!Array.isArray(x)&&String(x.player_id||'')===playerId))return node;
  for(const x of node){const found=rawPlayerSample(x,playerId,depth+1);if(found)return found}
 }else for(const x of Object.values(node)){const found=rawPlayerSample(x,playerId,depth+1);if(found)return found}
 return null;
}
function selectedSlot(value){
 if(!value||typeof value!=='object')return null;
 if(Array.isArray(value)){
  for(const item of value){const found=selectedSlot(item);if(found)return found;}
  return null;
 }
 if(typeof value.position==='string'&&value.position)return value.position;
 if(value.selected_position)return selectedSlot(value.selected_position);
 return null;
}
function findPlayers(node,out=[],depth=0,inheritedSlot=null){
 if(!node||typeof node!=='object'||depth>22)return out;
 if(Array.isArray(node)){
  // Yahoo represents a player as [metadataArray, {selected_position:[...]}].
  // Find its lineup slot before descending into the metadata array.
  const slot=node.map(x=>x&&typeof x==='object'&&!Array.isArray(x)?selectedSlot(x.selected_position):null).find(Boolean)||inheritedSlot;
  const props=node.filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
  const id=props.find(x=>x.player_id)?.player_id;
  const name=props.find(x=>x.name)?.name;
  if(id&&name){
   const n=typeof name==='string'?name:name?.full;
   const team=props.find(x=>x.editorial_team_abbr)?.editorial_team_abbr||null;
   const status=props.find(x=>x.status)?.status||null;
   if(n){
    const rawPositions=props.find(x=>x.eligible_positions)?.eligible_positions;
    const eligiblePositions=Array.isArray(rawPositions)?rawPositions.flatMap(x=>typeof x==='string'?[x]:x?.position?[x.position]:[]):[];
    const ownership=props.find(x=>x.percent_owned)?.percent_owned;
    const started=props.find(x=>x.percent_started)?.percent_started;
    const rank=props.find(x=>x.rank)?.rank;
    const percentStarted=typeof started==='number'||typeof started==='string'?started:null;
    out.push({yahooId:String(id),name:n,slot:slot||'UNKNOWN',nbaTeam:team,status,eligiblePositions,percentOwned:ownership??null,yahooRank:rank??null,forecast:{percentStarted,next7DayRank:null,next14DayRank:null,restOfSeasonRank:null},depthChart:[],dataCoverage:{eligiblePositions:eligiblePositions.length>0,percentStarted:percentStarted!==null,depthChart:false,forecastRanks:false}});
   }
   return out;
  }
  for(const v of node)findPlayers(v,out,depth+1,slot);
 }else{
  const slot=selectedSlot(node.selected_position)||inheritedSlot;
  for(const v of Object.values(node))findPlayers(v,out,depth+1,slot);
 }
 return out;
}
async function liveHandler(req,res){
 if(req.method!=='GET')return response(res,405,{error:'Method not allowed'});
 if(!configured()||!storeConfigured())return response(res,503,{mode:'UNAVAILABLE',error:'OAuth not configured'});
 const sid=cookies(req).yahoo_session;
 let session;try{session=await loadSession(sid)}catch{return response(res,503,{mode:'UNAVAILABLE',error:'Session database unavailable'})}
 if(!session?.refresh_token)return response(res,401,{mode:'NOT_CONNECTED',error:'Yahoo login required'});
 try{
  if(!session.access_token||Date.now()+60000>=session.expires_at){
   const t=await tokenRequest({grant_type:'refresh_token',refresh_token:session.refresh_token});
   if(!t.access_token)throw Error('Yahoo token refresh failed');
   session={access_token:t.access_token,refresh_token:t.refresh_token||session.refresh_token,expires_at:Date.now()+(Number(t.expires_in)||3600)*1000};
   await saveSession(sid,session);
  }
  const teams=await read(session.access_token,'users;use_login=1/games;game_keys=nba/teams?format=json');
  const matches=findTeams(teams).filter(x=>/\.l\.85892\.t\.5$/.test(x.key));
  const unique=[...new Map(matches.map(x=>[x.key,x])).values()];
  if(unique.length!==1)return response(res,409,{mode:'UNAVAILABLE',error:'League 85892 team 5 was not found in the authorized Yahoo account',teamMatches:unique.length});
  if(req.query?.allRosters==='1'){
   const leagueKey=unique[0].key.split('.t.')[0];
   const teamsRaw=await read(session.access_token,'league/'+leagueKey+'/teams?format=json');
   const leagueTeams=[...new Map(findTeams(teamsRaw).filter(t=>t.key.startsWith(leagueKey+'.t.')).map(t=>[t.key,t])).values()];
   if(!leagueTeams.length)return response(res,502,{mode:'YAHOO_ALL_ROSTERS_UNAVAILABLE',error:'No league teams parsed'});
   const results=await Promise.allSettled(leagueTeams.map(async team=>{
    const raw=await read(session.access_token,'team/'+team.key+'/roster?format=json');
    return {...team,players:[...new Map(findPlayers(raw).map(p=>[p.yahooId,p])).values()]};
   }));
   const teamsOut=[],errors=[];
   results.forEach((result,i)=>result.status==='fulfilled'?teamsOut.push(result.value):errors.push({teamKey:leagueTeams[i].key,upstreamStatus:result.reason?.status||null}));
   return response(res,200,{mode:'YAHOO_ALL_ROSTERS',leagueId:85892,observedAt:new Date().toISOString(),teams:teamsOut,teamCount:teamsOut.length,playerCount:teamsOut.reduce((n,t)=>n+t.players.length,0),errors,readOnly:true});
  }
  if(req.query?.leagueData==='1'){
   const leagueKey=unique[0].key.split('.t.')[0];
   const endpoints={
    settings:'league/'+leagueKey+'/settings?format=json',
    teams:'league/'+leagueKey+'/teams?format=json',
    standings:'league/'+leagueKey+'/standings?format=json',
    scoreboard:'league/'+leagueKey+'/scoreboard?format=json',
    roster:'team/'+unique[0].key+'/roster?format=json'
   };
   const entries=await Promise.allSettled(Object.entries(endpoints).map(async ([name,path])=>[name,await read(session.access_token,path)]));
   const sources={},errors=[];
   for(let i=0;i<entries.length;i++){
    const name=Object.keys(endpoints)[i],entry=entries[i];
    if(entry.status==='fulfilled')sources[name]=entry.value[1];
    else errors.push({section:name,upstreamStatus:entry.reason?.status||null});
   }
   // This is a read-only, authenticated source of truth. Raw Yahoo structures
   // are retained to avoid silently losing scoring/waiver fields in parsing.
   if(!sources.teams&&!sources.roster)return response(res,502,{mode:'YAHOO_LEAGUE_UNAVAILABLE',errors});
   return response(res,200,{mode:'YAHOO_LEAGUE_DATA',leagueId:85892,teamId:5,teamKey:unique[0].key,observedAt:new Date().toISOString(),source:'Yahoo Fantasy Sports API',readOnly:true,sections:sources,rosterPlayers:sources.roster?[...new Map(findPlayers(sources.roster).map(p=>[p.yahooId,p])).values()]:[],leagueTeams:sources.teams?[...new Map(findTeams(sources.teams).map(t=>[t.key,t])).values()]:[],errors});
  }
  if(req.query?.matchup==='1'){
   const data=await read(session.access_token,'team/'+encodeURIComponent(unique[0].key)+'/matchups?format=json');
   const matches=[];
   function walk(node,depth=0){
    if(!node||typeof node!=='object'||depth>24)return;
    if(Array.isArray(node)){for(const v of node)walk(v,depth+1);return}
    if(node.matchup&&typeof node.matchup==='object')matches.push(node.matchup);
    for(const [k,v] of Object.entries(node))if(k!=='matchup')walk(v,depth+1);
   }
   walk(data);
   const weeks=[];
   for(const m of matches){
    const obj=Array.isArray(m)?Object.assign({},...m.filter(v=>v&&typeof v==='object'&&!Array.isArray(v))):m;
    if(!obj.week)continue;
    weeks.push({week:Number(obj.week),weekStart:obj.week_start||null,weekEnd:obj.week_end||null,status:obj.status||null,teams:obj.teams||null,winnerTeamKey:obj.winner_team_key||null});
   }
   const current=weeks.filter(x=>x.weekStart&&x.weekEnd&&new Date(x.weekStart+'T00:00:00Z')<=new Date()&&new Date(x.weekEnd+'T23:59:59Z')>=new Date()).sort((a,b)=>b.week-a.week)[0];
   return response(res,200,{mode:'YAHOO_MATCHUPS_API',observedAt:new Date().toISOString(),leagueId:85892,teamKey:unique[0].key,current:current||null,availableWeeks:weeks.map(x=>({week:x.week,start:x.weekStart,end:x.weekEnd})),readOnly:true});
  }
  if(req.query?.freeAgents==='1'){
   const leagueKey=unique[0].key.split('.t.')[0];
   const start=Math.max(0,Math.min(150,Number.parseInt(String(req.query.start||'0'),10)||0));
   const limit=25;
   const url='league/'+leagueKey+'/players;status=A;sort=AR;start='+start+';count='+limit+'?format=json';
   const result=await read(session.access_token,url);
   const found=findPlayers(result);
   // Yahoo's league players response uses the same metadata arrays as rosters.
   const byId=[...new Map(found.map(p=>[p.yahooId,p])).values()];
   const statuses=[];
   function inspect(node,depth=0){
    if(!node||typeof node!=='object'||depth>20)return;
    if(Array.isArray(node)){
     const meta=node.filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
     const id=meta.find(x=>x.player_id)?.player_id;
     if(id)statuses.push({id:String(id),ownership:meta.find(x=>x.status)?.status||null,waiverDate:meta.find(x=>x.waiver_date)?.waiver_date||null,percentOwned:meta.find(x=>x.percent_owned)?.percent_owned||null,eligiblePositions:meta.find(x=>x.eligible_positions)?.eligible_positions||null});
     for(const v of node)inspect(v,depth+1);
    }else for(const v of Object.values(node))inspect(v,depth+1);
   }
   inspect(result);
   const meta=new Map(statuses.map(x=>[x.id,x]));
   const free=byId.map(p=>({...p,...(meta.get(p.yahooId)||{}),slot:undefined,availability:'FREE_AGENT'}));
   return response(res,200,{mode:'YAHOO_FREE_AGENTS',leagueId:85892,observedAt:new Date().toISOString(),start,count:free.length,requested:limit,players:free,notes:['Yahoo status A = free agent. Waiver status W is not included.','No player add/drop action is performed.','Sort AR is Yahoo average rank, not a personalized matchup projection.']});
  }
  const roster=await read(session.access_token,'team/'+encodeURIComponent(unique[0].key)+'/roster?format=json');
  if(req.query?.sample==='10094'){
   const raw=rawPlayerSample(roster,'10094');
   if(!raw)return response(res,404,{error:'Player 10094 not found in Yahoo roster'});
   return response(res,200,{source:'Yahoo Fantasy Sports API',leagueId:85892,teamId:5,yahooPlayerId:'10094',rawPlayer:raw});
  }
  const players=[...new Map(findPlayers(roster).map(x=>[x.yahooId,x])).values()];
  if(players.length<1)return response(res,502,{mode:'UNAVAILABLE',error:'Yahoo roster returned no recognizable players'});
  return response(res,200,{mode:'YAHOO_API_LIVE',observedAt:new Date().toISOString(),leagueId:85892,teamId:5,teamKey:unique[0].key,teamName:unique[0].name,players,source:'Yahoo Fantasy Sports API',readOnly:true});
 }catch(e){return response(res,e.status===401?401:502,{mode:'UNAVAILABLE',error:'Yahoo API read failed',upstreamStatus:e.status||null})}
}
