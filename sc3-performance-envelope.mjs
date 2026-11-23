// Common Yahoo-linked ESPN evidence envelope for owner-scoped live views.
// Keep source coverage distinct from per-player completeness.
export function linkedPerformanceEnvelope(data,requestedIds){
 const {report,links,historyEnd,expectedEnd,missingDays,fresh}=data||{};
 if(!report||!Array.isArray(report.players)||!(links instanceof Map)||!Array.isArray(requestedIds))
  throw Error('Invalid performance evidence');
 const byId=new Map(report.players.map(p=>[String(p.id),p]));
 const verifiedFresh=fresh===true&&typeof historyEnd==='string'&&historyEnd===expectedEnd&&
    Array.isArray(missingDays)&&missingDays.length===0;
 return {mode:'YAHOO_LINKED_PERFORMANCE',historyEnd:historyEnd??null,expectedEnd:expectedEnd??null,
  missingDays:Array.isArray(missingDays)?missingDays:null,fresh:verifiedFresh,
  source:report.source,pool:report.pool,readOnly:true,
  players:requestedIds.map(id=>({yahooId:String(id),
   performance:links.has(String(id))?byId.get(String(links.get(String(id))))??null:null}))};
}
