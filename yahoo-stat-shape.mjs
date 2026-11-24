// Counts-only response-shape diagnostics for an already authorized Yahoo API read.
// Never returns names, IDs, raw stats, URLs, response bodies or credentials.
export function inspectYahooStatShape(raw,requestedIds=[]){
 const expected=new Set(requestedIds.map(String)),matched=new Set();
 const coverageTypes={average_season:0,season:0,lastweek:0,lastmonth:0,unknown:0};
 let playerContainers=0,statBlocks=0,matchingStatBlocks=0,statRows=0,missingIdContainers=0,visited=0,truncated=false;
 const walk=(value,depth=0)=>{
  if(!value||typeof value!=='object'||depth>24)return;
  if(++visited>20000){truncated=true;return;}
  if(Array.isArray(value.player)){
   playerContainers++;
   const meta=Array.isArray(value.player[0])?value.player[0]:[];
   const rawId=meta.find(x=>x&&typeof x==='object'&&x.player_id!==undefined)?.player_id;
   if(rawId===undefined)missingIdContainers++;
   const matchedId=rawId!==undefined&&expected.has(String(rawId));
   if(matchedId)matched.add(String(rawId));
   for(const block of value.player.slice(1)){
    const stats=block?.player_stats;
    if(!stats||typeof stats!=='object')continue;
    statBlocks++;
    if(matchedId)matchingStatBlocks++;
    statRows+=Array.isArray(stats.stats)?stats.stats.length:0;
    const name=String(stats.coverage_type??'');
    if(Object.prototype.hasOwnProperty.call(coverageTypes,name)&&name!=='unknown')coverageTypes[name]++;
    else coverageTypes.unknown++;
   }
  }
  for(const child of Object.values(value))walk(child,depth+1);
 };
 walk(raw);
 return {schema:'counts_only',playerContainers,matchingPlayerIds:matched.size,missingIdContainers,
  statBlocks,matchingStatBlocks,statRows,coverageTypes,truncated};
}
