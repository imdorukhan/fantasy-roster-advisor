import {withScopedTransaction} from './sc3-postgres.mjs';
import {attachVerifiedDepth} from './sc3-verified-depth.mjs';
import {attachInjuryReports,fetchEspnInjuryFeed,ESPN_INJURY_SOURCE} from './sc3-injury-feed.mjs';
import {rosterIdentityFallback,readRosterIdentityInputs} from './sc3-roster-identity.mjs';
const maxYahooAgeMs=30*3600000;
export function buildInjuryEvidence(roster,rows,observedAt,now=Date.now(),{feed=null,identities=[]}={}){
 if(!Array.isArray(roster)||roster.length<1||roster.length>20||
    new Set(roster.map(p=>p.yahooId)).size!==roster.length||
    roster.some(p=>!/^\d+$/.test(String(p.yahooId))||!p.name||typeof p.name!=='string')||
    !Array.isArray(rows))throw Error('Verified Yahoo roster is unavailable');
 const age=now-Date.parse(observedAt);
 if(!Number.isFinite(age)||age<0||age>maxYahooAgeMs)throw Error('Yahoo injury roster snapshot stale');
 const depth=attachVerifiedDepth({freeAgents:{count:roster.length,players:roster}},rows,now);
 const players=attachInjuryReports(depth.freeAgents.players,identities,feed).map(player=>{
  const yahooStatus=typeof player.status==='string'?player.status:null;
  const yahooFlagged=Boolean(yahooStatus&&yahooStatus!=='A');
  const onInjuryList=/^(IL|IL\+|IR|IR\+)$/.test(player.slot||'');
  const espnDepthVerified=player.depthRanks.length>0;
  const espnDepthIL=player.depthRanks.some(row=>row.injuryMarker==='IL');
  return {yahooId:player.yahooId,name:player.name,nbaTeam:player.nbaTeam||null,
   rosterSlot:player.slot||null,yahooStatus,yahooFlagged,onInjuryList,
   espnDepthVerified,espnDepthIL,
   espnObservedAt:espnDepthVerified?player.depthRanks[0].observedAt:null,
   espnReport:player.espnReport,reportedReturnDate:player.espnReport?.reportedReturnDate??null,
   returnDate:null,returnDateVerified:false,executable:false};
 }).filter(p=>p.yahooFlagged||p.onInjuryList||p.espnDepthIL||p.espnReport);
 return {mode:'SC3_INJURY_EVIDENCE',status:'verified',readOnly:true,
  yahooObservedAt:observedAt,yahooSource:'Yahoo Fantasy Sports API roster snapshot',
  espnSource:'ESPN full depth chart, verified Yahoo–ESPN player IDs',
  depthCoverage:depth.depthCoverage,injuryFeed:{status:feed?'verified_source':'unavailable',source:ESPN_INJURY_SOURCE,observedAt:feed?.observedAt??null,teamGroups:feed?.teamGroups??null,matched:players.filter(p=>p.espnReport).length},players};
}
export async function readInjuryEvidence(roster,observedAt,{now=new Date(),pool,fetcher=fetch}={}){
 const ids=roster.map(p=>String(p.yahooId));
 const [db,feed]=await Promise.all([
  withScopedTransaction(async c=>{
   const known=(await c.query("select yahoo_id,espn_id,status,evidence from sc3.sc3_player_identity where status='verified'")).rows;
   const {players,catalog}=await readRosterIdentityInputs(c,now.getTime());
   const identities=[...known,...rosterIdentityFallback(players,known,catalog)].filter(p=>ids.includes(String(p.yahoo_id)));
   const rows=identities.length?(await c.query(`select i.yahoo_id,i.espn_id,'verified' as status,d.nba_team,d.position,d.rank,d.observed_at::text,d.injury_marker
    from jsonb_to_recordset($1::jsonb) as i(yahoo_id text,espn_id text)
    join sc3.nba_depth_chart d on d.espn_id=i.espn_id
    order by i.yahoo_id,d.position,d.rank`,[JSON.stringify(identities)])).rows:[];
   return {identities,rows};
  },{pool}),
  fetchEspnInjuryFeed({now,fetcher}).catch(()=>null)
 ]);
 return buildInjuryEvidence(roster,db.rows,observedAt,now.getTime(),{feed,identities:db.identities});
}
