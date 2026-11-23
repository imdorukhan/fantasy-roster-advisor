// Explicit coverage contract for a legacy Yahoo snapshot bridge that does not
// contain live per-player stats. Do not substitute ESPN values as Yahoo stats.
export function unavailableYahooStatCoverage(requestedIds){
 if(!Array.isArray(requestedIds))throw Error('Expected Yahoo player IDs');
 const ids=[...new Set(requestedIds.map(String))];
 if(ids.length<1||ids.length>25||ids.some(id=>!/^\d{1,10}$/.test(id)))throw Error('Invalid Yahoo player ID request');
 return {
  mode:'YAHOO_PLAYER_STATS',status:'unavailable',readOnly:true,
  source:'Yahoo live player stats unavailable in authorized snapshot bridge; ESPN performance is a separate source',
  players:ids.map(yahooId=>({yahooId,stats:null,mpg:null})),
  coverage:{
   requested:ids.length,returned:0,missingIds:ids,complete:false,
   errors:[{section:'Yahoo live player stats unavailable in snapshot bridge'}]
  }
 };
}
