import fs from 'node:fs';
const BASE='https://fantasysports.yahooapis.com/fantasy/v2';
const LEAGUE_ID='85892', TEAM_ID='5';
const TOKEN=process.env.YAHOO_ACCESS_TOKEN;
const DRY_RUN=true;
const log=(s)=>console.log(s);
async function get(url){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+TOKEN,Accept:'application/json'}});
  if(!r.ok)throw new Error('Yahoo API HTTP '+r.status+' '+(await r.text()).slice(0,300));
  return r.json();
}
function flatten(v,out=[]){if(v&&typeof v==='object'){if(v.player_key&&v.name?.full)out.push({key:v.player_key,name:v.name.full,status:v.status||'',position:v.display_position||''});for(const x of Object.values(v))flatten(x,out)}return out}
async function main(){
  if(!TOKEN){log('SETUP_REQUIRED: Yahoo OAuth access token not configured. No network or roster changes made.');return;}
  const user=await get(BASE+'/users;use_login=1/games;game_codes=nba/teams?format=json');
  fs.writeFileSync('yahoo-teams.json',JSON.stringify(user,null,2));
  const raw=JSON.stringify(user);
  const keys=[...raw.matchAll(/"(?:team_key)"\s*:\s*"([^"]+)"/g)].map(x=>x[1]);
  const key=keys.find(k=>k.includes('.l.'+LEAGUE_ID+'.t.'+TEAM_ID));
  if(!key){log('TEAM_NOT_FOUND: Check authorized Yahoo account and league ID. Available matching keys: '+keys.filter(k=>k.includes('.l.'+LEAGUE_ID+'.')).join(', '));return;}
  const leagueKey=key.split('.t.')[0];
  const urls={
    settings:BASE+'/league/'+leagueKey+'/settings?format=json',
    roster:BASE+'/team/'+key+'/roster/players?format=json',
    freeagents:BASE+'/league/'+leagueKey+'/players;status=FA;count=25?format=json',
    matchups:BASE+'/team/'+key+'/matchups?format=json'
  };
  const results={generated_at:new Date().toISOString(),league_key:leagueKey,team_key:key,dry_run:DRY_RUN};
  for(const [name,url] of Object.entries(urls)){try{results[name]=await get(url);log('Fetched '+name)}catch(e){results[name+'_error']=String(e.message);log(name+': '+e.message)}}
  fs.writeFileSync('snapshot.json',JSON.stringify(results,null,2));
  const roster=[...new Map(flatten(results.roster).map(x=>[x.key,x])).values()];
  const agents=[...new Map(flatten(results.freeagents).map(x=>[x.key,x])).values()];
  fs.writeFileSync('players-summary.json',JSON.stringify({roster,freeagents:agents},null,2));
  log('Snapshot saved. Roster: '+roster.length+', free agents returned: '+agents.length);
  log('APPROVAL REQUIRED: This bot NEVER submits roster transactions.');
}
main().catch(e=>{console.error('ERROR:',e.message);process.exitCode=1});
