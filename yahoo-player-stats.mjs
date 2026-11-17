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
