// Single authenticated Yahoo league source shared by all dashboard modules.
// Only the caller's authenticated session can access the endpoint.
let pending=null;
export function getLeagueData({refresh=false}={}){
 if(refresh||!pending){
  pending=fetch('/api/auto-data?live=1&leagueData=1',{credentials:'same-origin',cache:'no-store'})
   .then(async r=>{const d=await r.json();if(!r.ok||d.mode!=='YAHOO_LEAGUE_DATA')throw Error(d.error||'Yahoo league data unavailable ('+r.status+')');return d})
   .catch(e=>{pending=null;throw e});
 }
 return pending;
}
export function leagueHealth(d){
 const sections=['settings','teams','standings','scoreboard','roster'];
 return sections.map(k=>({name:k,available:!!d.sections?.[k],stale:(d.staleSections||[]).includes(k),updatedAt:d.sectionTimestamps?.[k]||null}));
}
