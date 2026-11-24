// A depth ranking is usable only through an explicitly verified Yahoo-to-ESPN ID link.
// Never infer an identity from similar names or a team abbreviation alone.
const canonicalTeam = value => ({GSW:'GS',NOP:'NO',NYK:'NY',SAS:'SA',WAS:'WSH',BRK:'BKN',PHO:'PHX',UTAH:'UTA'}[String(value||'').toUpperCase()]||String(value||'').toUpperCase());
const positions = new Set(['PG','SG','SF','PF','C']);
const maxDepthAgeMs = 26*3600000;
export function attachVerifiedDepth(snapshot, rows, now=Date.now()){
 const freeAgents=snapshot?.freeAgents;
 if(!Array.isArray(freeAgents?.players)||!Array.isArray(rows))throw Error('Invalid verified depth input');
 const byId=new Map(),invalid=new Set();
 const players=new Map(freeAgents.players.map(p=>[String(p.yahooId),p]));
 for(const row of rows){
  const id=String(row?.yahoo_id||''),p=players.get(id);
  if(!p)continue;
  const stamp=Date.parse(row.observed_at),age=now-stamp;
  const valid=row.status==='verified'&&/^\d+$/.test(String(row.espn_id||''))&&
   canonicalTeam(p.nbaTeam)===row.nba_team&&positions.has(row.position)&&
   Number.isInteger(row.rank)&&row.rank>=1&&row.rank<=20&&Number.isFinite(age)&&age>=0&&age<=maxDepthAgeMs;
  if(!valid){invalid.add(id);continue;}
  const group=byId.get(id)||{espnId:row.espn_id,positions:new Map()};
  if(group.espnId!==row.espn_id||group.positions.has(row.position))invalid.add(id);
  else group.positions.set(row.position,{position:row.position,rank:row.rank,observedAt:row.observed_at,injuryMarker:row.injury_marker??null});
  byId.set(id,group);
 }
 let covered=0;
 const enhanced=freeAgents.players.map(p=>{
  const id=String(p.yahooId),group=byId.get(id);
  const depthRanks=!invalid.has(id)&&group
   ? [...group.positions.values()].sort((a,b)=>a.rank-b.rank||a.position.localeCompare(b.position)):[];
  if(depthRanks.length)covered++;
  return {...p,depthRanks};
 });
 return {...snapshot,freeAgents:{...freeAgents,players:enhanced},depthCoverage:{
  verifiedPlayers:covered,totalPlayers:enhanced.length,
  source:'ESPN full depth chart, verified Yahoo–ESPN player identity',readOnly:true
 }};
}
