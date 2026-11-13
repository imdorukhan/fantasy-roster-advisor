import {cookies,configured,tokenRequest} from './auth/yahoo/_lib.js';
import {loadSession,saveSession,storeConfigured} from './auth/yahoo/_store.js';
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
function findPlayers(node,out=[],depth=0){
 if(!node||typeof node!=='object'||depth>22)return out;
 if(Array.isArray(node)){
  const props=node.filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
  const id=props.find(x=>x.player_id)?.player_id;
  const name=props.find(x=>x.name)?.name;
  if(id&&name){
   const n=typeof name==='string'?name:name.full;
   const team=props.find(x=>x.editorial_team_abbr)?.editorial_team_abbr||null;
   const status=props.find(x=>x.status)?.status||null;
   const pos=node.find(x=>x?.selected_position)?.selected_position?.[0]?.position||null;
   if(n)out.push({yahooId:String(id),name:n,slot:pos||'UNKNOWN',nbaTeam:team,status});
   return out;
  }
  for(const v of node)findPlayers(v,out,depth+1);
 }else for(const v of Object.values(node))findPlayers(v,out,depth+1);
 return out;
}
export default async function handler(req,res){
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
  const roster=await read(session.access_token,'team/'+encodeURIComponent(unique[0].key)+'/roster?format=json');
  const players=[...new Map(findPlayers(roster).map(x=>[x.yahooId,x])).values()];
  if(players.length<1)return response(res,502,{mode:'UNAVAILABLE',error:'Yahoo roster returned no recognizable players'});
  return response(res,200,{mode:'YAHOO_API_LIVE',observedAt:new Date().toISOString(),leagueId:85892,teamId:5,teamKey:unique[0].key,teamName:unique[0].name,players,source:'Yahoo Fantasy Sports API',readOnly:true});
 }catch(e){return response(res,e.status===401?401:502,{mode:'UNAVAILABLE',error:'Yahoo API read failed',upstreamStatus:e.status||null})}
}
