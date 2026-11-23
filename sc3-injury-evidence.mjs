import {withScopedTransaction} from './sc3-postgres.mjs';
import {attachVerifiedDepth} from './sc3-verified-depth.mjs';
const maxYahooAgeMs=30*3600000;
export function buildInjuryEvidence(roster,rows,observedAt,now=Date.now()){
 if(!Array.isArray(roster)||roster.length<1||roster.length>20||
    new Set(roster.map(p=>p.yahooId)).size!==roster.length||
    roster.some(p=>!/^\d+$/.test(String(p.yahooId))||!p.name||typeof p.name!=='string')||
    !Array.isArray(rows))throw Error('Verified Yahoo roster is unavailable');
 const age=now-Date.parse(observedAt);
 if(!Number.isFinite(age)||age<0||age>maxYahooAgeMs)throw Error('Yahoo injury roster snapshot stale');
 const depth=attachVerifiedDepth({freeAgents:{count:roster.length,players:roster}},rows,now);
 const players=depth.freeAgents.players.map(player=>{
  const yahooStatus=typeof player.status==='string'?player.status:null;
  const yahooFlagged=Boolean(yahooStatus&&yahooStatus!=='A');
  const onInjuryList=/^(IL|IL\+|IR|IR\+)$/.test(player.slot||'');
  const espnDepthVerified=player.depthRanks.length>0;
  const espnDepthIL=player.depthRanks.some(row=>row.injuryMarker==='IL');
  return {yahooId:player.yahooId,name:player.name,nbaTeam:player.nbaTeam||null,
   rosterSlot:player.slot||null,yahooStatus,yahooFlagged,onInjuryList,
   espnDepthVerified,espnDepthIL,
   espnObservedAt:espnDepthVerified?player.depthRanks[0].observedAt:null,
   returnDate:null,returnDateVerified:false,executable:false};
 }).filter(p=>p.yahooFlagged||p.onInjuryList||p.espnDepthIL);
 return {mode:'SC3_INJURY_EVIDENCE',status:'verified',readOnly:true,
  yahooObservedAt:observedAt,yahooSource:'Yahoo Fantasy Sports API roster snapshot',
  espnSource:'ESPN full depth chart, verified Yahoo–ESPN player IDs',
  depthCoverage:depth.depthCoverage,players};
}
export async function readInjuryEvidence(roster,observedAt,{now=new Date(),pool}={}){
 const ids=roster.map(p=>String(p.yahooId));
 const rows=await withScopedTransaction(async c=>(await c.query(
  `select i.yahoo_id,i.espn_id,i.status,d.nba_team,d.position,d.rank,
          d.observed_at::text,d.injury_marker
   from sc3.sc3_player_identity i join sc3.nba_depth_chart d on d.espn_id=i.espn_id
   where i.status='verified' and i.yahoo_id=any($1::text[])
   order by i.yahoo_id,d.position,d.rank`,[ids]
 )).rows,{pool});
 return buildInjuryEvidence(roster,rows,observedAt,now.getTime());
}
