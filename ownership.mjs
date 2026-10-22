import snapshot from './data/rosters-2026-10-22.json' with {type:'json'};
const normalize=name=>String(name||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[’‘]/g,"'").replace(/[^a-z0-9]/gi,'').toLowerCase();
const map=new Map();
for(const team of snapshot.teams)for(const p of team.players){const k=normalize(p.name);if(map.has(k))throw Error('Duplicate roster ownership: '+p.name);map.set(k,team.team_name)}
export function findSnapshotOwner(name){return map.get(normalize(name))||null}
export function filterPossiblyFreeAgents(players){if(!Array.isArray(players))throw Error('Expected player list');return players.filter(p=>!findSnapshotOwner(p.name))}
export function getUserSnapshot(){const team=snapshot.teams.find(t=>t.team_name===snapshot.user_team_name);if(!team)throw Error('User team unavailable');return {teamName:team.team_name,players:team.players,teamIdVerified:snapshot.team_id_mapping_verified,snapshotDate:snapshot.snapshot_date}}
export function rosterSnapshotSummary(){return {teams:snapshot.teams.length,ownedPlayers:map.size,snapshotDate:snapshot.snapshot_date,verifiedLive:false}}
