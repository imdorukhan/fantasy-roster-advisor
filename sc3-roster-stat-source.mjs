// Read-only, provenance-preserving fallback for roster stat presentation.
export function rosterStatSource(player, performance){
 const yahoo=player?.stats?.values;
 if(yahoo&&typeof yahoo==='object'&&!Array.isArray(yahoo))
  return {source:'Yahoo player statistics',values:yahoo,through:null};
 const season=performance?.season;
 if(performance?.fresh===true && season?.complete===true &&
   Number.isInteger(season.games) && season.games>0 &&
   /^\d{4}-\d{2}-\d{2}$/.test(performance.historyEnd||'') &&
   season.values && typeof season.values==='object' && !Array.isArray(season.values) &&
   ['PTS','REB','AST','STL','BLK','TO','FG%','FT%'].every(k=>Number.isFinite(season.values[k])&&season.values[k]>=0))
  return {source:'ESPN completed-game season averages',values:{...season.values,GP:season.games},through:performance.historyEnd};
 return {source:'Unavailable',values:null,through:null};
}
