import league from './league.config.json' with {type:'json'};
const counting=['PTS','REB','AST','STL','BLK','3PM','TO'];
const attempts=['FGM','FGA','FTM','FTA'];
const all=[...counting,...attempts];
const goodNumber=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const safeGames=arr=>Array.isArray(arr)?arr.filter(g=>g&&g.played===true&&g.minutes>0&&all.every(k=>goodNumber(g[k]??0))).slice(-3):[];
const avg=(arr,key)=>arr.reduce((sum,x)=>sum+(x[key]||0),0)/arr.length;
const rounded=n=>Number(n.toFixed(3));
function vector(games){return Object.fromEntries(all.map(k=>[k,avg(games,k)]))}
function impact(games,base,weights={}){
 const recent=vector(games),result={};let deficit=0;let improvement=0;
 for(const c of league.categories){
  if(c==='FG%'||c==='FT%'){
   const m=c==='FG%'?'FGM':'FTM',a=c==='FG%'?'FGA':'FTA';
   const baseline=base[m]/Math.max(1,base[a]),now=recent[m]/Math.max(1,recent[a]);
   const swing=(now-baseline)*Math.min(1,recent[a]/(c==='FG%'?12:5));
   result[c]=rounded(swing*100);
   deficit+=Math.max(0,-swing)*(weights[c]??1);
   improvement+=Math.max(0,swing)*(weights[c]??1);
  }else{
   const change= (recent[c]-base[c])/(Math.max(Math.abs(base[c]), c==='TO'?1:1));
   const good=c==='TO'?-change:change;
   result[c]=rounded(good*100);
   deficit+=Math.max(0,-good)*(weights[c]??1);
   improvement+=Math.max(0,good)*(weights[c]??1);
  }
 }
 return {recent,perCategory:result,deficit,improvement};
}
/** No drop recommendation from exactly three games alone. */
export function rankDropRisk({roster,weights={},minRecentGames=3}){
 if(!Array.isArray(roster))throw Error('roster required');
 const result=[];
 for(const p of roster){
  const played=safeGames(p.lastGames);
  const base=p.baselinePerGame;
  const protectedPlayer=p.undroppable===true||p.keeperProtected===true;
  const injured=['OUT','INJ','IL','O','GTD','Q'].includes(String(p.status||'').toUpperCase())||p.minutesRestriction===true;
  if(played.length<minRecentGames||!base||all.some(k=>!goodNumber(base[k]??0))){
   result.push({player:p.name,status:'INSUFFICIENT_DATA',recentGames:played.length,dropCandidate:false,executable:false,reason:'Need three played games and a verified longer-term baseline.'});continue;
  }
  const score=impact(played,base,weights);
  const mins=avg(played,'minutes'),baselineMins=p.baselineMinutes;
  const minutesDrop=goodNumber(baselineMins)&&baselineMins>0?Math.max(0,(baselineMins-mins)/baselineMins):null;
  const slump=score.deficit>score.improvement*1.25&&score.deficit>0.65;
  // Independent long-term value is essential: do not cut stars based on a three-game skid.
  const replaceable=p.longTermTier==='streamer'||p.longTermTier==='fringe';
  const dropCandidate=slump&&replaceable&&!injured&&!protectedPlayer&&p.cantCutVerified===true&&p.roleTrendVerified===true;
  result.push({player:p.name,status:dropCandidate?'DROP_REVIEW':slump?'WATCH_SLUMP':'HOLD',dropCandidate,recentGames:played.length,minutesLast3:rounded(mins),minutesDropPercent:minutesDrop===null?null:rounded(minutesDrop*100),categoryChangePercent:score.perCategory,downsideScore:rounded(score.deficit),upsideScore:rounded(score.improvement),protected:protectedPlayer,injuryCaution:injured,executable:false,requiresApproval:true,reason:dropCandidate?'Three-game decline plus independently verified fringe role; compare a real available replacement before dropping.':injured?'Injury/minutes restriction requires recovery review, not automatic drop.':protectedPlayer?'Protected from cut despite short-term slump.':'Three games are insufficient for irreversible cut decisions without verified role and replacement.'});
 }
 return result.sort((a,b)=>(b.dropCandidate?1:0)-(a.dropCandidate?1:0)||((b.downsideScore||0)-(a.downsideScore||0)));
}
