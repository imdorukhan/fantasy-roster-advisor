// Deterministic Yahoo Fantasy NBA stat normalization. Read-only.
export function statCategoryId(root,labels){
 const accepted=new Set(labels.map(x=>String(x).trim().toLowerCase()));
 let found=null;
 function walk(n,d=0){
  if(!n||typeof n!=='object'||d>22)return;
  if(Array.isArray(n)){n.forEach(x=>walk(x,d+1));return;}
  if(n.stat_id!==undefined){
   const names=[n.name,n.display_name,n.abbr,n.short_name].filter(x=>typeof x==='string').map(x=>x.trim().toLowerCase());
   if(names.some(x=>accepted.has(x)))found=String(n.stat_id);
  }
  Object.values(n).forEach(v=>walk(v,d+1));
 }
 walk(root);return found;
}
export function minuteValue(raw){
 if(typeof raw==='number')return Number.isFinite(raw)&&raw>=0&&raw<=60?Math.round(raw*10)/10:null;
 if(typeof raw!=='string')return null;
 const s=raw.trim();
 let n;
 if(/^\d{1,2}:\d{2}$/.test(s)){
  const [m,sec]=s.split(':').map(Number);
  if(sec>=60)return null;
  n=m+sec/60;
 }else if(/^(?:\d+|\d{1,2}\.\d{1,3})$/.test(s))n=Number(s);
 else return null;
 return Number.isFinite(n)&&n>=0&&n<=60?Math.round(n*10)/10:null;
}
export function averageMinutesByPlayer(root,minutesStatId){
 const out=new Map();if(minutesStatId===null||minutesStatId===undefined)return out;
 function traverse(n,d=0){
  if(!n||typeof n!=='object'||d>22)return;
  if(Array.isArray(n)){n.forEach(x=>traverse(x,d+1));return;}
  if(Array.isArray(n.player)){
   const player=n.player;
   // Yahoo player node = [metadata array, {player_stats:{stats:[...]}}]
   const meta=Array.isArray(player[0])?player[0]:player;
   const playerId=meta.find?.(x=>x&&typeof x==='object'&&x.player_id!==undefined)?.player_id;
   let raw=null;
   function findStat(v,k=0){if(!v||typeof v!=='object'||k>13)return;
    if(Array.isArray(v)){v.forEach(x=>findStat(x,k+1));return;}
    if(v.stat_id!==undefined&&String(v.stat_id)===String(minutesStatId)&&v.value!==undefined)raw=v.value;
    Object.values(v).forEach(x=>findStat(x,k+1));
   }
   // Restrict scan to associated stats, not the player's metadata.
   for(const section of player.slice(1))findStat(section);
   const mpg=minuteValue(raw);
   if(playerId!==undefined&&mpg!==null)out.set(String(playerId),mpg);
  }
  Object.values(n).forEach(v=>traverse(v,d+1));
 }
 traverse(root);return out;
}


// All Yahoo game-defined stat categories, with canonical NBA aliases.
// Preserve unknown Yahoo stats by ID rather than inventing a meaning.
export const STAT_ALIASES={
 MPG:['Minutes Played','Minutes','MIN','MPG'],GP:['Games Played','GP'],
 'FG%':['Field Goal Percentage','Field Goal %','FG%'], 'FT%':['Free Throw Percentage','Free Throw %','FT%'],
 '3PM':['Three Pointers Made','3-point Shots Made','3PTM','3PM','3PT Made'],
 PTS:['Points','PTS'],REB:['Total Rebounds','Rebounds','REB'],AST:['Assists','AST'],
 STL:['Steals','ST','STL'],BLK:['Blocks','BLK'],TO:['Turnovers','TO','TOV'],
 FGM:['Field Goals Made','FGM'],FGA:['Field Goals Attempted','FGA'],
 FTM:['Free Throws Made','FTM'],FTA:['Free Throws Attempted','FTA'],
 '3PA':['Three Pointers Attempted','3-point Shots Attempted','3PA','3PTA'],
 '3P%':['Three Point Percentage','3-point Percentage','3P%','3PT%'],
 OREB:['Offensive Rebounds','OREB','OR'],DREB:['Defensive Rebounds','DREB','DR'],
 PF:['Personal Fouls','PF'],DD:['Double Doubles','DD'],TD:['Triple Doubles','TD']
};
const cleanLabel=s=>String(s??'').trim().toLowerCase().replace(/[^a-z0-9%]/g,'');
export function statCatalog(root){
 const catalog=new Map();
 function walk(v,d=0){if(!v||typeof v!=='object'||d>25)return;
 if(!Array.isArray(v)&&v.stat_id!==undefined&&(v.name||v.display_name||v.abbr)){
 const id=String(v.stat_id),labels=[v.name,v.display_name,v.abbr,v.short_name].filter(Boolean);
 const canonical=Object.entries(STAT_ALIASES).find(([,aliases])=>aliases.some(a=>labels.some(l=>cleanLabel(a)===cleanLabel(l))))?.[0]||null;
 catalog.set(id,{id,label:String(v.display_name||v.name||v.abbr),name:String(v.name||v.display_name||v.abbr),canonical});
 } Object.values(v).forEach(x=>walk(x,d+1));}
 walk(root);return catalog;
}
function normalizeStat(raw,canonical){
 if(raw===null||raw===undefined||raw==='')return null;
 if(canonical==='MPG')return minuteValue(raw);
 if(typeof raw==='number'||typeof raw==='string'&&/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw.trim())){
 const n=Number(raw);if(!Number.isFinite(n)||n<0)return null;
 if(canonical?.endsWith('%')&&n>1)return null;
 return n;
 }
 return typeof raw==='string'&&/^\d+(?:\.\d+)?\/\d+(?:\.\d+)?$/.test(raw.trim())?raw.trim():null;
}
export function playerStatRecords(root,catalog,{coverage='average_season',observedAt=new Date().toISOString()}={}){
 const out=new Map();
 function walk(v,d=0){if(!v||typeof v!=='object'||d>25)return;
 if(Array.isArray(v.player)&&Array.isArray(v.player[0])){
 const meta=v.player[0],id=meta.find(x=>x?.player_id!==undefined)?.player_id;
 const block=v.player.slice(1).find(x=>x?.player_stats)?.player_stats;
 if(id!==undefined&&block&&block.coverage_type===coverage&&Array.isArray(block.stats)){
 const values={},rawStats=[];
 for(const wrapper of block.stats){
 const stat=wrapper?.stat;if(stat?.stat_id===undefined)continue;
 const statId=String(stat.stat_id),def=catalog.get(statId),value=normalizeStat(stat.value,def?.canonical);
 rawStats.push({id:statId,label:def?.label||'Yahoo stat '+statId,value,raw:stat.value??null});
 if(def?.canonical&&value!==null)values[def.canonical]=value;
 }
 out.set(String(id),{coverage,observedAt,source:'Yahoo Fantasy Sports API',values,rawStats});
 }}
 Object.values(v).forEach(x=>walk(x,d+1));}
 walk(root);return out;
}
export async function loadPlayerStats({read,gameKey,playerIds,coverage='average_season',batchSize=25}){
 if(!['average_season','season','lastweek','lastmonth'].includes(coverage))throw Error('Unsupported Yahoo stat window');
 const ids=[...new Set(playerIds.map(String))].filter(x=>/^\d+$/.test(x));
 if(!/^\d+$/.test(String(gameKey)))throw Error('Invalid game key');
 const catalog=statCatalog(await read('game/'+gameKey+'/stat_categories?format=json'));
 const records=new Map(),errors=[];
 const size=Math.min(25,Math.max(1,batchSize));
 for(let i=0;i<ids.length;i+=size){
 const batch=ids.slice(i,i+size);
 try{
 const payload=await read('players;player_keys='+batch.map(id=>gameKey+'.p.'+id).join(',')+'/stats;type='+coverage+'?format=json');
 const parsed=playerStatRecords(payload,catalog,{coverage});
 for(const [id,record] of parsed)if(batch.includes(id))records.set(id,record);
 }catch(e){errors.push({count:batch.length,status:e.status||null});}
 }
 return {records,requested:ids.length,returned:records.size,errors};
}
