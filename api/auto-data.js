import crypto from 'node:crypto';
import {parseMatchup} from '../matchup-data.mjs';
import {loadPlayerStats} from '../yahoo-player-stats.mjs';
import {dataHealth} from '../decision-core.mjs';
import {teamCode,teams as depthTeams} from '../sc3-depth-store.mjs';
import {requireSc3Read} from '../sc3-read-access.mjs';
import {sc3ProductionEnabled} from '../sc3-yahoo-bridge.mjs';
import {officialMatchupFromScoreboard,currentMatchupIdentityFromScoreboard,currentMatchupCategoryCoverage} from '../yahoo-scoreboard.mjs';
import {safeMatchupFailure,isYahooIncompleteCurrentWeek} from '../sc3-matchup-error.mjs';
import {cookies,configured} from './auth/yahoo/_lib.js';
import {yahooSessionClient} from './auth/yahoo/_refresh.js';
import {loadSessionRecord,storeConfigured,loadLeagueSnapshots,saveLeagueSnapshots,loadBackgroundYahooSession} from './auth/yahoo/_store.js';
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
 // Read Yahoo's current selected matchup to determine the opponent. Never
 // assume the October 2026 opponent is still the current opponent.
 const results=await Promise.allSettled([get(YAHOO+'5').then(r=>r.text()),get(YAHOO+'matchup?mid1=5').then(r=>r.text())]);
 const errors=[];let ourRoster=null,opponentRoster=null,opponentId=null;
 try{if(results[0].status!=='fulfilled')throw Error('Yahoo team page unavailable');ourRoster=parseYahooRoster(results[0].value,5)}
 catch(e){errors.push({section:'our roster',reason:e.message})}
 try{
  if(results[1].status!=='fulfilled')throw Error('Yahoo matchup page unavailable');
  const parsed=parseMatchup(results[1].value);
  if(!Number.isInteger(parsed.opponent.id)||parsed.opponent.id===5||parsed.opponent.id<1||parsed.opponent.id>100)throw Error('Opponent ID invalid');
  opponentId=parsed.opponent.id;
  const reply=await get(YAHOO+opponentId).then(r=>r.text());
  opponentRoster=parseYahooRoster(reply,opponentId);
 }catch(e){errors.push({section:'current opponent roster',reason:e.message})}
 const rosters=[ourRoster,opponentRoster];
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
 return {mode:'PUBLIC_READ_ONLY',observedAt:new Date().toISOString(),sourceLinks:{yahooOurRoster:YAHOO+'5',yahooOpponentRoster:YAHOO+'13',espn:'https://www.espn.com/nba/schedule'},teams:[{id:5,name:'Salary CAPtain',players:next(rosters[0])},{id:opponentId,name:opponentRoster?'Current Yahoo opponent':'Opponent not verified',players:next(rosters[1])}],window:{start,end:dates.at(-1),days:length},schedule,coverage:{yahooOurRoster:!!rosters[0],yahooOpponentRoster:!!rosters[1],espnDatesFetched:datesFetched,espnDatesRequested:length},errors,opponentIdVerified:opponentId!==null,notes:['Public Yahoo roster may reflect a different selected date or locked lineup; verify current status from source','Upcoming NBA games are schedule opportunities, not guaranteed active fantasy starts','No free agents or add/drop recommendations are inferred without verified ownership']};
}
const depthCache=new Map();
export async function espnDepth(abbr){
 abbr=teamCode(abbr);
 if(!depthTeams.includes(abbr))throw Error('Unknown NBA team');
 const cached=depthCache.get(abbr);if(cached&&Date.now()-cached.at<3600000)return cached.value;
 const root='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
 const teamsResponse=await fetch(root+'teams',{signal:AbortSignal.timeout(8000)});
 if(!teamsResponse.ok)throw Error('ESPN team catalog unavailable');
 const teamsJson=await teamsResponse.json();
 const teams=teamsJson.sports?.[0]?.leagues?.[0]?.teams||[];
 const matches=teams.filter(t=>teamCode(t.team?.abbreviation)===abbr);
 const match=matches.length===1?matches[0]:null;
 if(!match?.team?.id)throw Error('NBA team abbreviation not found');
 const response=await fetch(root+'teams/'+encodeURIComponent(match.team.id)+'/depthcharts',{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('ESPN depth chart HTTP '+response.status);
 const json=await response.json(),rows=[];
 const positions=json.depthchart?.[0]?.positions||{};
 const supported={pg:'PG',sg:'SG',sf:'SF',pf:'PF',c:'C'};
 for(const [key,position] of Object.entries(supported)){
  const athletes=positions[key]?.athletes;
  if(!Array.isArray(athletes))continue;
  athletes.forEach((athlete,index)=>{
   const name=athlete.displayName||athlete.fullName||athlete.athlete?.displayName;
   if(name)rows.push({name,position,rank:index+1,source:'ESPN',espnAthleteId:athlete.id||null});
  });
 }
 const value={source:'ESPN NBA depth chart',observedAt:new Date().toISOString(),nbaTeam:abbr,rows:[...new Map(rows.map(x=>[x.name.toLowerCase()+'|'+x.position,x])).values()]};
 depthCache.set(abbr,{at:Date.now(),value});return value;
}
// Owner-gated read-only health check for protected preview and opted-in production.
async function sc3CloudHealth(req,res){
 if(!await requireSc3Read(req,res))return;
 let stage='imports';
 try{
  const {readPerformance}=await import('../performance-store.mjs');
  const {withScopedTransaction}=await import('../sc3-postgres.mjs');
  stage='database';
  const counts=await withScopedTransaction(async c=>{
   const {rows}=await c.query("select (select count(*)::int from sc3.sc3_nba_game_logs) as logs,(select count(*)::int from sc3.sc3_nba_sync_days) as days,(select count(*)::int from sc3.espn_player_identity) as espn,(select count(*)::int from sc3.sc3_player_identity where status='verified') as verified");
   return rows[0];
  });
  stage='performance';
  const {report,links,historyEnd,expectedEnd,missingDays,fresh}=await readPerformance({scoped:true,start:process.env.SC3_SEASON_START});
  const w=report.players.find(p=>p.id==='5104157');
  const c=report.players.find(p=>p.id==='3975');
  const publicTestData=req.query?.sample==='1'?{
   source:report.source,historyEnd,pool:report.pool,
   players:['5104157','3975','4898371'].map(espnId=>({espnId,performance:report.players.find(p=>p.id===espnId)||null}))
  }:undefined;
  return res.status(200).json({status:fresh?'ok':'degraded',scopedRole:true,counts,historyEnd,expectedEnd,missingDays,fresh,pool:report.pool,rankingAvailable:report.rankingAvailable,verifiedLinks:links.size,publicSamples:{wembanyama:{rank:w?.z?.rank??null,chart:w?.chart?.length??0},curry:{rank:c?.z?.rank??null,chart:c?.chart?.length??0}},publicTestData});
 }catch(e){
  const allowed=['28P01','28000','42501','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','CERT_HAS_EXPIRED','ERR_TLS_CERT_ALTNAME_INVALID','53400','53300','57P01','25006','42601','42703','42P01'];
  const safeMessages=['Invalid scoped PostgreSQL connection','SC3 database URL missing','SC3 database URL scheme missing','SC3 database URL role mismatch','SC3 database URL endpoint mismatch','SC3 database password segment invalid','Shared SC3 database is not enabled','Scoped role verification failed','Incomplete NBA history','Stored game-log coverage mismatch','Performance report unavailable','Invalid ISO date range','Invalid dates'];
  const msg=String(e?.message||'');
  const classes=[['POOLER_TENANT_OR_USER',/tenant or user not found|tenant not found|user not found/i],['POOLER_STARTUP_PARAMETER',/startup parameter|unrecognized configuration parameter/i],['CONNECT_TIMEOUT',/connection timeout|timeout expired|connection terminated due to connection timeout/i],['MODULE_LOAD',/cannot find (module|package)|require\(\) of ES Module/i],['INVALID_URL',/invalid url|URI malformed/i],['PASSWORD_AUTH',/password authentication failed|authentication failed|SASL/i],['CERTIFICATE',/certificate|self.signed/i],['CONNECTION_CLOSED',/connection terminated|server closed the connection/i],['SQL_PERMISSION',/permission denied/i]];
  const code=allowed.includes(e.code)?e.code:safeMessages.includes(e.message)?e.message:classes.find(([,re])=>re.test(msg))?.[0]||(/^[A-Z][A-Z0-9_]{2,40}$/.test(e.code||'')?e.code:'SC3_CLOUD_UNAVAILABLE');
  console.warn('SC3 cloud readiness failed',code);
  return res.status(503).json({status:'unavailable',stage,code});
 }
}

export const config={maxDuration:300};
export default async function handler(req,res){
 if(req.query?.sc3NbaHistorySync==='1'){
  const {nbaHistoryCron}=await import('../sc3-freshness-sync.mjs');
  return nbaHistoryCron(req,res);
 }
 if(req.query?.sc3ScoreboardSync==='1'){
  const {yahooScoreboardCron}=await import('../sc3-freshness-sync.mjs');
  return yahooScoreboardCron(req,res,{readScoreboard:async()=>{
   const owner=await loadBackgroundYahooSession();
   if(!owner)throw Error('Owner authorization unavailable');
   const client=yahooSessionClient(owner,{read:(token,path)=>read(token,path,{require200:true})});
   await client.ready();
   return client.read('league/478.l.85892/scoreboard?format=json');
  }});
 }
 if(req.query?.sc3P0Probe==='1'){
  const {p0PreviewProbe}=await import('../sc3-p0-preview-probe.mjs');
  return p0PreviewProbe(req,res);
 }
 if(req.query?.sc3DepthProbe==='1'){
  const {depthPreviewProbe}=await import('../sc3-depth-sync.mjs');
  return depthPreviewProbe(req,res);
 }
 if(req.query?.sc3DepthSync==='1'){
  const {depthSync}=await import('../sc3-depth-sync.mjs');
  return depthSync(req,res);
 }
 if(req.query?.sc3YahooSync==='1'){
  const {fullSync}=await import('../sc3-yahoo-full-sync.mjs');
  return fullSync(req,res,{
   loadSession:loadBackgroundYahooSession,
   createClient:owner=>yahooSessionClient(owner,{read:(token,path)=>read(token,path,{require200:true})}),
   findTeams,findPlayers
  });
 }
 if(req.query?.yahooCloudCheck==='1'){
  const {yahooCloudCheck}=await import('../yahoo-cloud-check.mjs');
  return yahooCloudCheck(req,res,{
   loadSession:loadBackgroundYahooSession,
   createClient:owner=>yahooSessionClient(owner,{read:(token,path)=>read(token,path,{require200:true})}),
   findTeams,findPlayers
  });
 }
 if(req.query?.sc3Player==='1'){
  if(!await requireSc3Read(req,res))return;
  const id=req.query?.id, dropId=req.query?.dropId;
  if(dropId!==undefined&&(typeof dropId!=='string'||!/^\d{1,10}$/.test(dropId)))return response(res,400,{error:'Valid Yahoo drop player ID required'});
  if(typeof id!=='string'||!/^\d{1,10}$/.test(id))return response(res,400,{error:'Valid Yahoo player ID required'});
  try{
   const {readPlayerEvaluation}=await import('../sc3-player-evaluation.mjs');
   const player=await readPlayerEvaluation(id,{dropId:dropId??null});
   if(player?.invalidDrop)return response(res,422,{error:'Select a player on your verified Yahoo roster'});
   return player?response(res,200,player):response(res,404,{error:'Player unavailable in verified Yahoo league data'});
  }catch{return response(res,503,{error:'Verified player evaluation unavailable'});}
 }
 if(req.query?.sc3LeagueRosters==='1'){
  if(!await requireSc3Read(req,res))return;
  try{
   const {readLeagueRosters}=await import('../sc3-league-rosters.mjs');
   return response(res,200,await readLeagueRosters());
  }catch{return response(res,503,{error:'Verified Yahoo league rosters unavailable'});}
 }
 if(req.query?.sc3MatchupLineups==='1'){
  if(!await requireSc3Read(req,res))return;
  try{
   const {readMatchupLineups}=await import('../sc3-matchup-lineups.mjs');
   return response(res,200,await readMatchupLineups({includeProjection:req.query?.projection==='1'}));
  }catch(error){const result=safeMatchupFailure(error);return response(res,result.status,result.body);}
 }
 if(req.query?.sc3Streaming==='1'){
  if(!await requireSc3Read(req,res))return;
  try{
   const {readStreamingAvailability}=await import('../sc3-streaming.mjs');
   return response(res,200,await readStreamingAvailability({includeWaiverImpact:req.query?.waiverImpact==='1'}));
  }catch{return response(res,503,{error:'Verified Yahoo availability unavailable'});}
 }
 if(req.query?.sc3DailySync==='1'){
  res.setHeader('Cache-Control','private, no-store');
  if(process.env.VERCEL_ENV!=='preview'||process.env.SC3_SHARED_DB!=='1')return res.status(404).json({error:'Not found'});
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  // This preview is protected by Vercel Authentication. The operation only
  // refreshes publicly available NBA data, never Yahoo data.
  try{const {dailySync}=await import('../sc3-daily-sync.mjs');const result=await dailySync();return res.status(result.complete?200:503).json(result)}
  catch{return res.status(503).json({error:'SC3 daily sync unavailable'})}
 }
 if(req.query?.sc3Health==='1')return sc3CloudHealth(req,res);
 if(req.query?.cron==='1')return backgroundLeagueSync(req,res);
 if(req.query?.depthTeam){
  const team=String(req.query.depthTeam).toUpperCase();
  if(!/^[A-Z]{2,3}$/.test(team)||!depthTeams.includes(teamCode(team)))return res.status(400).json({error:'Invalid NBA team'});
  try{if((process.env.VERCEL_ENV==='preview'||sc3ProductionEnabled())&&process.env.SC3_SHARED_DB==='1'){const {readDepth}=await import('../sc3-depth-store.mjs');const data=await readDepth(team);res.setHeader('Cache-Control','private, no-store');return res.status(200).json(data)}const data=await espnDepth(team);res.setHeader('Cache-Control','public, s-maxage=3600');return res.status(200).json(data)}
  catch(e){return res.status(502).json({error:'ESPN depth chart unavailable',detail:e.message})}
 }
 if(req.query?.live==='1'&&req.query?.officialMatchup==='1'&&sc3ProductionEnabled()){
  if(!await requireSc3Read(req,res))return;
  return bridgeHandler(req,res);
 }
 if(req.query?.live==='1')return liveHandler(req,res);
 try{const result=await buildAutoData();res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=600');res.status(200).json(result)}
 catch(e){res.setHeader('Cache-Control','no-store');res.status(503).json({error:'Automatic public sources unavailable',reason:String(e.message)})}
}




async function backgroundLeagueSync(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 const expected=process.env.CRON_SECRET||'';
 const supplied=(req.headers.authorization||'').replace(/^Bearer /,'');
 const valid=expected.length>=32&&supplied.length===expected.length&&crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(supplied));
 if(!valid)return res.status(401).json({error:'Unauthorized'});
 try{
  const owner=await loadBackgroundYahooSession();
  if(!owner?.tokens?.refresh_token)return res.status(503).json({error:'Owner Yahoo authorization unavailable'});
  const client=yahooSessionClient(owner,{read});
  await client.ready();
  const leagueKey='478.l.85892';
  const endpoints={
   settings:'league/'+leagueKey+'/settings?format=json',
   teams:'league/'+leagueKey+'/teams?format=json',
   standings:'league/'+leagueKey+'/standings?format=json',
   scoreboard:'league/'+leagueKey+'/scoreboard?format=json',
   roster:'team/'+leagueKey+'.t.5/roster?format=json'
  };
  const settled=await Promise.allSettled(Object.entries(endpoints).map(async ([name,path])=>[name,await client.read(path)]));
  const sections={},failed=[];
  settled.forEach((item,i)=>{if(item.status==='fulfilled')sections[item.value[0]]=item.value[1];else failed.push(Object.keys(endpoints)[i])});
  if(!Object.keys(sections).length)return res.status(502).json({status:'failed',failed});
  const written=await saveLeagueSnapshots(85892,sections);
  return res.status(failed.length?207:200).json({status:failed.length?'partial':'ok',savedSections:written,failed,observedAt:new Date().toISOString()});
 }catch(e){console.error('Background Yahoo sync failed:',safeRefreshCode(e));return res.status(503).json({error:'Background sync unavailable',category:safeRefreshCode(e)})}
}

const refreshCodes=new Set(['owner_authorization_unavailable','refresh_store_unavailable','refresh_busy','refresh_outcome_uncertain','invalid_refresh_response','refresh_save_failed','session_changed_during_refresh']);
const safeRefreshCode=e=>refreshCodes.has(e?.code)?e.code:'yahoo_unavailable';
const BASE='https://fantasysports.yahooapis.com/fantasy/v2/';
const response=(res,status,body)=>{res.setHeader('Cache-Control','private, no-store');return res.status(status).json(body)};
export async function read(token,path,{require200=false}={}){
 const r=await fetch(BASE+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
 if(!r.ok||(require200&&r.status!==200))throw Object.assign(Error('Yahoo Fantasy API rejected request'),{status:r.status});
 const j=await r.json();if(!j.fantasy_content)throw Error('Invalid Yahoo Fantasy response');return j.fantasy_content;
}
async function enrichPlayerStats(gameKey,players,coverage,client,{diagnostics=false}={}){
 const uniqueIds=[...new Set(players.map(p=>String(p.yahooId)).filter(x=>/^\d+$/.test(x)))];
 try{
  const result=await loadPlayerStats({read:path=>client.read(path),gameKey,playerIds:uniqueIds,coverage,diagnostics});
  return {players:players.map(p=>{const record=result.records.get(String(p.yahooId));return {...p,stats:record||null,mpg:record?.values?.MPG??null}}),
   coverage:{requested:result.requested,returned:result.returned,complete:result.complete,missingIds:result.missingIds,
    nineCatReady:result.nineCatReady,missingNineCatById:result.missingNineCatById,
    invalidNineCatById:result.invalidNineCatById,errors:result.errors,window:coverage,
    ...(diagnostics?{diagnostics:result.diagnostics}:{})}};
 }catch(e){return {players:players.map(p=>({...p,stats:null,mpg:null})),coverage:{requested:uniqueIds.length,returned:0,errors:[{status:e.status||null}],window:coverage}}}
}
export function findTeams(node,out=[],depth=0){
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
export function findPlayers(node,out=[],depth=0,inheritedSlot=null){
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
    const rank=props.find(x=>x.rank)?.rank;const jersey=props.find(x=>x.uniform_number!=null)?.uniform_number??null;
    const percentStarted=typeof started==='number'||typeof started==='string'?started:null;
    out.push({yahooId:String(id),name:n,slot:slot||'UNKNOWN',nbaTeam:team,jersey,status,eligiblePositions,percentOwned:ownership??null,yahooRank:rank??null,forecast:{percentStarted,next7DayRank:null,next14DayRank:null,restOfSeasonRank:null},depthChart:[],dataCoverage:{eligiblePositions:eligiblePositions.length>0,percentStarted:percentStarted!==null,depthChart:false,forecastRanks:false}});
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
async function bridgeHandler(req,res){
 if(req.method!=='GET')return response(res,405,{error:'Method not allowed'});
 try{
  const {bridgeSnapshots}=await import('../sc3-yahoo-bridge.mjs');
  const saved=await bridgeSnapshots();
  const sections=Object.fromEntries(Object.entries(saved).map(([k,v])=>[k,v.payload]));
  const timestamps=Object.fromEntries(Object.entries(saved).map(([k,v])=>[k,v.observed_at]));
  const roster=[...new Map(findPlayers(sections.roster).map(p=>[p.yahooId,p])).values()];
  const leagueTeams=[...new Map(findTeams(sections.teams).map(t=>[t.key,t])).values()];
  const teamKey='478.l.85892.t.5';
  if(!roster.length||!leagueTeams.some(t=>t.key===teamKey))return response(res,503,{mode:'UNAVAILABLE',error:'Verified league snapshots unavailable'});
  const observedAt=timestamps.roster;
  const staleSections=Object.keys(sections).filter(k=>!Number.isFinite(Date.parse(timestamps[k]))||Date.now()-Date.parse(timestamps[k])>30*3600000);
  const common={leagueId:85892,teamId:5,teamKey,readOnly:true,bridge:true,source:'Yahoo Fantasy Sports API via existing connection snapshots'};
  if(req.query?.health==='1')return response(res,200,{...common,mode:'YAHOO_SYSTEM_HEALTH',status:staleSections.length?'degraded':'healthy',checkedAt:new Date().toISOString(),sections:['settings','teams','standings','scoreboard','roster'].map(section=>({section,status:!saved[section]?'missing':staleSections.includes(section)?'stale':'fresh',observedAt:timestamps[section]||null}))});
  if(req.query?.performance==='1'||req.query?.playerStats==='1'){
   const ids=[...new Set(String(req.query.ids||'').split(',').filter(x=>/^\d+$/.test(x)))];
   if(!ids.length||ids.length>25)return response(res,400,{error:'Supply 1–25 Yahoo player IDs'});
   const {readPerformance}=await import('../performance-store.mjs');
   const {report,links,historyEnd,expectedEnd,missingDays,fresh}=await readPerformance({scoped:true,start:process.env.SC3_SEASON_START});
   const byId=new Map(report.players.map(p=>[p.id,p]));
   const get=id=>links.has(id)?byId.get(links.get(id))||null:null;
   if(req.query.performance==='1')return response(res,200,{...common,mode:'YAHOO_LINKED_PERFORMANCE',historyEnd,expectedEnd,missingDays,fresh,source:report.source,pool:report.pool,players:ids.map(yahooId=>({yahooId,performance:get(yahooId)}))});
   const {unavailableYahooStatCoverage}=await import('../sc3-yahoo-player-stat-coverage.mjs');
   return response(res,200,{...common,...unavailableYahooStatCoverage(ids)});
  }
  if(req.query?.officialMatchup==='1'){
   try{return response(res,200,{...officialMatchupFromScoreboard(sections.scoreboard,{observedAt:timestamps.scoreboard,teamKey}),bridge:true})}
   catch(e){
    if(isYahooIncompleteCurrentWeek(e)){
     try{
      const verified=currentMatchupIdentityFromScoreboard(sections.scoreboard,{observedAt:timestamps.scoreboard,teamKey});
      const categoryCoverage=currentMatchupCategoryCoverage(sections.scoreboard,{observedAt:timestamps.scoreboard,teamKey});
      return response(res,422,{...common,...verified,categoryCoverage,mode:'YAHOO_OFFICIAL_MATCHUP_STATS_PENDING',error:'Yahoo current-week category totals incomplete or not yet published'});
     }catch{ /* Cannot verify current week; do not expose unverified identities. */ }
    }
    return response(res,422,{...common,mode:'YAHOO_OFFICIAL_MATCHUP_UNAVAILABLE',error:e.message});
   }
  }
  if(req.query?.allRosters==='1'||req.query?.freeAgents==='1'||req.query?.playerPool==='1'||req.query?.matchup==='1'||req.query?.sample)return response(res,503,{...common,mode:'UNAVAILABLE',error:'This data is not included in existing Yahoo snapshots; no inferred ownership or live stats'});
  if(req.query?.leagueData==='1'){
   let injuryEvidence={mode:'SC3_INJURY_EVIDENCE',status:'unavailable',readOnly:true,players:[]};
   try{
    const {readInjuryEvidence}=await import('../sc3-injury-evidence.mjs');
    injuryEvidence=await readInjuryEvidence(roster,observedAt);
   }catch{ /* Preserve Yahoo roster visibility when verified ESPN injury evidence is unavailable. */ }
   return response(res,200,{...common,mode:'YAHOO_LEAGUE_DATA',observedAt,sections,sectionTimestamps:timestamps,staleSections,dbBacked:true,rosterPlayers:roster,leagueTeams,injuryEvidence,errors:[]});
  }
  return response(res,200,{...common,mode:'YAHOO_API_LIVE',observedAt,teamName:leagueTeams.find(t=>t.key===teamKey)?.name,players:roster,staleSections});
 }catch{return response(res,503,{mode:'UNAVAILABLE',error:'Verified Yahoo snapshot bridge unavailable',readOnly:true})}
}
async function liveHandler(req,res){
 if((await import('../sc3-yahoo-bridge.mjs')).bridgeEnabled())return bridgeHandler(req,res);
 if(req.method!=='GET')return response(res,405,{error:'Method not allowed'});
 if(!configured()||!storeConfigured())return response(res,503,{mode:'UNAVAILABLE',error:'OAuth not configured'});
 const sid=cookies(req).yahoo_session;
 let owner;try{owner=await loadSessionRecord(sid)}catch{return response(res,503,{mode:'UNAVAILABLE',error:'Session database unavailable'})}
 if(!owner?.tokens?.refresh_token)return response(res,401,{mode:'NOT_CONNECTED',error:'Yahoo login required'});
 try{
  const client=yahooSessionClient(owner,{read});
  await client.ready();
  if(req.query?.health==='1'){
   const cached=await loadLeagueSnapshots(85892);
   const sections=['settings','teams','standings','scoreboard','roster'];
   const checkedAt=new Date().toISOString();
   const report=dataHealth(sections.map(name=>({name,observedAt:cached[name]?.observed_at||null,maxAgeMs:30*60*60*1000})));
   return response(res,200,{mode:'YAHOO_SYSTEM_HEALTH',leagueId:85892,checkedAt,status:report.healthy?'healthy':'degraded',sections:report.checks.map(x=>({section:x.source,status:x.status,observedAt:cached[x.source]?.observed_at||null,ageMs:x.ageMs})),readOnly:true});
  }
  const teams=await client.read('users;use_login=1/games;game_keys=nba/teams?format=json');
  const matches=findTeams(teams).filter(x=>/\.l\.85892\.t\.5$/.test(x.key));
  const unique=[...new Map(matches.map(x=>[x.key,x])).values()];
  if(unique.length!==1)return response(res,409,{mode:'UNAVAILABLE',error:'League 85892 team 5 was not found in the authorized Yahoo account',teamMatches:unique.length});
  if(req.query?.playerPool==='1'){
   const leagueKey=unique[0].key.split('.t.')[0];
   const start=Number(req.query.start??0);
   const {yahooPoolPath}=await import('../yahoo-player-pool.mjs');
   if(!Number.isInteger(start)||start<0||start>2500)return response(res,400,{error:'Invalid page offset'});
   const raw=await client.read(yahooPoolPath(leagueKey,start));
   const players=findPlayers(raw);
   return response(res,200,{mode:'YAHOO_PLAYER_POOL_PAGE',start,count:players.length,players,readOnly:true});
  }
  if(req.query?.performance==='1'){
   const ids=[...new Set(String(req.query.ids||'').split(',').filter(x=>/^\d+$/.test(x)))];
   if(!ids.length||ids.length>25)return response(res,400,{error:'Supply 1–25 Yahoo player IDs'});
   try{
    const {readPerformance}=await import('../performance-store.mjs');
    const evidence=await readPerformance({scoped:process.env.SC3_SHARED_DB==='1',url:process.env.SC3_DEV_SUPABASE_URL,secret:process.env.SC3_DEV_SUPABASE_SECRET_KEY,expectedRef:process.env.SC3_DEV_SUPABASE_REF,start:process.env.SC3_SEASON_START,end:process.env.SC3_HISTORY_END});
    const {linkedPerformanceEnvelope}=await import('../sc3-performance-envelope.mjs');
    return response(res,200,linkedPerformanceEnvelope(evidence,ids));
   }catch(e){return response(res,503,{mode:'PERFORMANCE_UNAVAILABLE',error:'Isolated verified performance data unavailable',readOnly:true})}
  }
  if(req.query?.playerStats==='1'){
   const ids=String(req.query.ids||'').split(',').filter(x=>/^\d+$/.test(x));
   if(!ids.length||ids.length>25)return response(res,400,{error:'Supply 1–25 Yahoo player IDs'});
   const window=String(req.query.window||'average_season');
   if(!['average_season','season','lastweek','lastmonth'].includes(window))return response(res,400,{error:'Unsupported stats window'});
   const result=await enrichPlayerStats(unique[0].key.split('.')[0],ids.map(yahooId=>({yahooId})),window,client,{diagnostics:req.query?.statsDiag==='1'});
   return response(res,200,{mode:'YAHOO_PLAYER_STATS',...result,readOnly:true});
  }
  if(req.query?.allRosters==='1'){
   const leagueKey=unique[0].key.split('.t.')[0];
   const teamsRaw=await client.read('league/'+leagueKey+'/teams?format=json');
   const leagueTeams=[...new Map(findTeams(teamsRaw).filter(t=>t.key.startsWith(leagueKey+'.t.')).map(t=>[t.key,t])).values()];
   if(!leagueTeams.length)return response(res,502,{mode:'YAHOO_ALL_ROSTERS_UNAVAILABLE',error:'No league teams parsed'});
   const results=await Promise.allSettled(leagueTeams.map(async team=>{
    const raw=await client.read('team/'+team.key+'/roster?format=json');
    return {...team,players:[...new Map(findPlayers(raw).map(p=>[p.yahooId,p])).values()]};
   }));
   const teamsOut=[],errors=[];
   results.forEach((result,i)=>result.status==='fulfilled'?teamsOut.push(result.value):errors.push({teamKey:leagueTeams[i].key,upstreamStatus:result.reason?.status||null}));
   return response(res,200,{mode:'YAHOO_ALL_ROSTERS',leagueId:85892,observedAt:new Date().toISOString(),teams:teamsOut,teamCount:teamsOut.length,playerCount:teamsOut.reduce((n,t)=>n+t.players.length,0),errors,readOnly:true});
  }
  if(req.query?.officialMatchup==='1'){
   const leagueKey=unique[0].key.split('.t.')[0];
   const saved=await loadLeagueSnapshots(85892).catch(()=>({}));
   let raw=saved?.scoreboard?.payload||null;
   let observedAt=saved?.scoreboard?.observed_at||null;
   const age=observedAt?Date.now()-Date.parse(observedAt):Infinity;
   if(!raw||!Number.isFinite(age)||age<0||age>2*60*1000){
    raw=await client.read('league/'+leagueKey+'/scoreboard?format=json');
    observedAt=new Date().toISOString();
    try{await saveLeagueSnapshots(85892,{scoreboard:raw})}catch{/* Return real-time data even when snapshot storage fails. */}
   }
   let current;
   try{current=officialMatchupFromScoreboard(raw,{observedAt,teamKey:unique[0].key});}
   catch(e){return response(res,422,{mode:'YAHOO_OFFICIAL_MATCHUP_UNAVAILABLE',error:e.message,readOnly:true})}
   return response(res,200,current);
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
   const errors=[],sources={},timestamps={};
   let stored={};
   try{stored=await loadLeagueSnapshots(85892)}catch(e){errors.push({section:'database-read',message:e.message})}
   const now=Date.now(),maxAge=5*60*1000;
   const refresh=req.query?.refresh==='1';
   const fresh=Object.keys(endpoints).every(k=>stored[k]?.payload&&now-Date.parse(stored[k].observed_at)<maxAge);
   if(fresh&&!refresh){
    for(const [k,v] of Object.entries(stored)){sources[k]=v.payload;timestamps[k]=v.observed_at}
   }else{
    const entries=await Promise.allSettled(Object.entries(endpoints).map(async ([name,path])=>[name,await client.read(path)]));
    const updated={};
    entries.forEach((entry,i)=>{
     const name=Object.keys(endpoints)[i];
     if(entry.status==='fulfilled'){updated[name]=entry.value[1];sources[name]=entry.value[1];timestamps[name]=new Date().toISOString()}
     else{errors.push({section:name,upstreamStatus:entry.reason?.status||null});if(stored[name]?.payload){sources[name]=stored[name].payload;timestamps[name]=stored[name].observed_at}}
    });
    if(Object.keys(updated).length){
     try{await saveLeagueSnapshots(85892,updated)}catch(e){errors.push({section:'database-write',message:e.message})}
    }
   }
   if(!sources.teams&&!sources.roster)return response(res,502,{mode:'YAHOO_LEAGUE_UNAVAILABLE',errors});
   const staleSections=Object.keys(sources).filter(k=>now-Date.parse(timestamps[k])>=maxAge);
   const rosterPlayers=sources.roster?[...new Map(findPlayers(sources.roster).map(p=>[p.yahooId,p])).values()]:[];
   const {attachOwnerInjuryEvidence}=await import('../sc3-owner-injury-evidence.mjs');
   const injuryEvidence=await attachOwnerInjuryEvidence(rosterPlayers,timestamps.roster,{
    enabled:sc3ProductionEnabled(),
    read:async(players,at)=>{
     const {readInjuryEvidence}=await import('../sc3-injury-evidence.mjs');
     return readInjuryEvidence(players,at);
    }
   });
   return response(res,200,{mode:'YAHOO_LEAGUE_DATA',leagueId:85892,teamId:5,teamKey:unique[0].key,observedAt:new Date().toISOString(),source:'Yahoo Fantasy Sports API via Supabase',readOnly:true,sections:sources,sectionTimestamps:timestamps,staleSections,dbBacked:Object.keys(stored).length>0,rosterPlayers,leagueTeams:sources.teams?[...new Map(findTeams(sources.teams).map(t=>[t.key,t])).values()]:[],injuryEvidence,errors});
  }
  if(req.query?.matchup==='1'){
   const data=await client.read('team/'+encodeURIComponent(unique[0].key)+'/matchups?format=json');
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
   const start=Math.max(0,Math.min(2000,Number.parseInt(String(req.query.start||'0'),10)||0));
   const limit=25;
   const url='league/'+leagueKey+'/players;status=FA;sort=AR;start='+start+';count='+limit+'?format=json';
   const result=await client.read(url);
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
   const free=byId.map(p=>({...p,...(meta.get(p.yahooId)||{}),slot:undefined,availability:'FREE_AGENT',mpg:null}));
   // MPG is a per-game number: use Yahoo average_season statistics, not
   // league scoring settings (many 9-CAT leagues do not score minutes).
   // Resolve the minute stat id from Yahoo game stat categories; never guess.
   const enriched=await enrichPlayerStats(leagueKey.split('.')[0],free,'average_season',client);
   return response(res,200,{mode:'YAHOO_FREE_AGENTS',leagueId:85892,observedAt:new Date().toISOString(),start,count:free.length,requested:limit,statsCoverage:enriched.coverage,players:enriched.players,notes:['Yahoo status FA = free agent only. Waiver status W is not included.','No player add/drop action is performed.','Sort AR is Yahoo average rank, not a personalized matchup projection.']});
  }
  const roster=await client.read('team/'+encodeURIComponent(unique[0].key)+'/roster?format=json');
  if(req.query?.sample==='10094'){
   const raw=rawPlayerSample(roster,'10094');
   if(!raw)return response(res,404,{error:'Player 10094 not found in Yahoo roster'});
   return response(res,200,{source:'Yahoo Fantasy Sports API',leagueId:85892,teamId:5,yahooPlayerId:'10094',rawPlayer:raw});
  }
  const players=[...new Map(findPlayers(roster).map(x=>[x.yahooId,x])).values()];
  if(players.length<1)return response(res,502,{mode:'UNAVAILABLE',error:'Yahoo roster returned no recognizable players'});
  return response(res,200,{mode:'YAHOO_API_LIVE',observedAt:new Date().toISOString(),leagueId:85892,teamId:5,teamKey:unique[0].key,teamName:unique[0].name,players,source:'Yahoo Fantasy Sports API',readOnly:true});
 }catch(e){return response(res,e.status===401?401:502,{mode:'UNAVAILABLE',error:'Yahoo API read failed',upstreamStatus:e.status||null,category:safeRefreshCode(e)})}
}
