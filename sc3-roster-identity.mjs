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
