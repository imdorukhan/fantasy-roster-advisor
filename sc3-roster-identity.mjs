import {matchPlayers} from './player-identity.mjs';
import {teamCode} from './sc3-depth-store.mjs';

// Use a verified complete Yahoo roster and independent ESPN catalog.
// Existing one-to-one verified links cannot be overwritten by fallback evidence.
export function rosterIdentityFallback(players,known,catalog){
 const occupied=new Set(known.map(r=>String(r.espn_id)));
 const ids=new Set(known.map(r=>String(r.yahoo_id)));
 const matches=matchPlayers(players.filter(p=>!ids.has(String(p.yahooId))),catalog.filter(p=>!occupied.has(String(p.espnId))));
 return matches.filter(r=>r.status==='verified').map(r=>({yahoo_id:r.yahooId,espn_id:r.espnId,status:'verified',evidence:r.evidence,source:'verified roster and ESPN catalog',persisted:false}));
}
export function profileCoverage(players,links,gameCounts){
 const byId=new Map(links.map(r=>[String(r.yahoo_id),r]));
 return players.map(p=>{
  const link=byId.get(String(p.yahooId));
  const count=link?Number(gameCounts.get(String(link.espn_id))??0):null;
  return {yahooId:p.yahooId,espnId:link?.espn_id??null,games:count,
   reason:!link?'IDENTITY_UNRESOLVED':count===0?'NO_REGULAR_SEASON_SAMPLE':count<3?'INSUFFICIENT_SAMPLE':'READY',
   persisted:link?link.persisted!==false:null};
 });
}
export const normalizeTeam=teamCode;

export async function readRosterIdentityInputs(c,now=Date.now()){
 const row=(await c.query("select payload,observed_at::text from sc3.yahoo_league_snapshots where league_id=85892 and section='all_rosters' and source='Yahoo Fantasy Sports API'")).rows[0];
 const age=now-Date.parse(row?.observed_at),p=row?.payload;
 if(!Number.isFinite(age)||age<0||age>30*3600_000||p?.mode!=='YAHOO_ALL_ROSTERS'||p.leagueId!==85892||p.complete!==true||p.teamCount!==14||p.teams?.length!==14||
  new Set(p.teams.map(t=>t.key)).size!==14||p.teams.some(t=>!/^478\\.l\\.85892\\.t\\.(?:[1-9]|1[0-4])$/.test(t.key)||!t.players?.length))return {players:[],catalog:[]};
 const players=p.teams.flatMap(t=>t.players);
 if(players.length!==p.playerCount||new Set(players.map(p=>p.yahooId)).size!==players.length)return {players:[],catalog:[]};
 const catalog=(await c.query("select espn_id as \"espnId\",name,nba_team as team,jersey,birth_date::text as \"birthDate\" from sc3.espn_player_identity")).rows;
 return {players,catalog};
}
