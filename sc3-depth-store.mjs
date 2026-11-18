import {withScopedTransaction} from './sc3-postgres.mjs';
export const depthSource='https://www.espn.com/nba/depth/_/type/full';
export const teams=Object.freeze('ATL BOS BKN CHA CHI CLE DAL DEN DET GS HOU IND LAC LAL MEM MIA MIL MIN NO NY OKC ORL PHI PHX POR SAC SA TOR UTA WSH'.split(' '));
const aliases={GSW:'GS',NOP:'NO',NYK:'NY',SAS:'SA',WAS:'WSH',BRK:'BKN',PHO:'PHX',UTAH:'UTA'};
export const teamCode=s=>aliases[String(s).toUpperCase()]||String(s).toUpperCase();
export const positions=Object.freeze(['PG','SG','SF','PF','C']);
export function validateDepth(rows){
 if(!Array.isArray(rows)||rows.length<150||rows.length>3000)throw Error('Incomplete depth chart');
 const groups=new Map();
 for(const r of rows){
  if(!teams.includes(r.nba_team)||!positions.includes(r.position)||!Number.isInteger(r.rank)||r.rank<1||r.rank>20||typeof r.player_name!=='string'||!r.player_name.trim()||r.player_name.length>150)throw Error('Invalid depth row');
  const k=r.nba_team+'|'+r.position;const g=groups.get(k)||[];g.push(r);groups.set(k,g);
 }
 if(groups.size!==150)throw Error('Incomplete team/position coverage');
 for(const g of groups.values()){g.sort((a,b)=>a.rank-b.rank);if(g.some((r,i)=>r.rank!==i+1)||new Set(g.map(r=>r.player_name.toLowerCase())).size!==g.length)throw Error('Invalid depth ordering');}
 return rows;
}
export async function readDepth(abbr,{pool,now=new Date()}={}){
 const team=teamCode(abbr);if(!teams.includes(team))throw Error('Unknown NBA team');
 return withScopedTransaction(async c=>{
 const {rows}=await c.query("select player_name as name,position,rank,observed_at::text,source from sc3.nba_depth_chart where nba_team=$1 order by position,rank",[team]);
 if(new Set(rows.map(r=>r.position)).size!==5||new Set(rows.map(r=>r.observed_at)).size!==1)throw Error('Verified full depth chart unavailable');
 const observedAt=rows[0].observed_at,age=+now-Date.parse(observedAt);
 if(!Number.isFinite(age)||age<0||age>48*3600000)throw Error('Depth chart stale');
 return {source:depthSource,observedAt,nbaTeam:abbr,fresh:age<=26*3600000,rows:rows.map(({name,position,rank,source})=>({name,position,rank,source}))};
 },{pool});
}
