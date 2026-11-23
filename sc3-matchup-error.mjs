const unverifiableCurrentWeek = new Set([
 'Exactly one official current Yahoo matchup required',
 'Yahoo scoreboard snapshot stale or undated',
 'Yahoo scoreboard format unavailable',
 'Opponent or week not verified',
 'Yahoo matchup date range could not be verified'
]);
export function safeMatchupFailure(e){
 if(e?.message==='Yahoo current-week category totals not published'){
  return {status:422,body:{mode:'YAHOO_CURRENT_WEEK_STATS_PENDING',error:'Yahoo has not published current-week 9-CAT totals yet',readOnly:true}};
 }
 if(unverifiableCurrentWeek.has(String(e?.message||''))){
  return {status:422,body:{mode:'YAHOO_CURRENT_WEEK_UNVERIFIED',error:'Current Yahoo matchup week is not verified yet',readOnly:true}};
 }
 return {status:503,body:{error:'Verified Yahoo and ESPN matchup lineups unavailable'}};
}
