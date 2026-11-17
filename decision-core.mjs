// Salary CAPtain 3.0 shared, read-only decision primitives.
// Pure functions: no network, tokens, transactions, or fabricated projections.
export const NINE_CAT=Object.freeze(['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO']);
export const LOWER_IS_BETTER=new Set(['TO']);
const finite=v=>typeof v==='number'&&Number.isFinite(v);
export function freshness(observedAt,{now=Date.now(),maxAgeMs=5*60*1000}={}){
 const timestamp=Date.parse(observedAt);
 const ageMs=now-timestamp;
 return {valid:Number.isFinite(timestamp)&&Number.isFinite(now)&&finite(maxAgeMs)&&maxAgeMs>0&&ageMs>=-60_000&&ageMs<=maxAgeMs,ageMs:Number.isFinite(timestamp)?ageMs:null,observedAt:observedAt||null};
}
export function categoryComparison(ours,theirs){
 const rows=[];
 for(const category of NINE_CAT){
  const a=ours?.[category],b=theirs?.[category];
  if(!finite(a)||!finite(b)||a<0||b<0)return {verified:false,rows:[],reason:'Missing or invalid '+category};
  if((category==='FG%'||category==='FT%')&&(a>1||b>1))return {verified:false,rows:[],reason:'Percentage out of range '+category};
  const delta=a-b,adjusted=delta*(LOWER_IS_BETTER.has(category)?-1:1);
  rows.push({category,ours:a,opponent:b,delta,leader:adjusted>0?'OURS':adjusted<0?'OPPONENT':'TIE',absoluteGap:Math.abs(delta)});
 }
 return {verified:true,rows,score:{ours:rows.filter(r=>r.leader==='OURS').length,opponent:rows.filter(r=>r.leader==='OPPONENT').length,ties:rows.filter(r=>r.leader==='TIE').length}};
}
export function evaluateMatchup(snapshot,{now=Date.now(),maxAgeMs=5*60*1000}={}){
 const age=freshness(snapshot?.observedAt||snapshot?.fetchedAt,{now,maxAgeMs});
 if(!snapshot?.ourTeam||!snapshot?.opponent)return {usable:false,reason:'Missing verified matchup identities',freshness:age};
 if(Number(snapshot.ourTeam.id)!==5||Number(snapshot.opponent.id)===5)return {usable:false,reason:'Unexpected Yahoo team identities',freshness:age};
 const comparison=categoryComparison(snapshot.ourTeam.stats,snapshot.opponent.stats);
 return {usable:age.valid&&comparison.verified,reason:!age.valid?'Matchup source is stale or undated':comparison.reason||null,freshness:age,...comparison};
}
export function categorySwing(comparison,{scaleByCategory={}}={}){
 if(!comparison?.verified||!Array.isArray(comparison.rows)||comparison.rows.length!==9)return {available:false,reason:'Verified nine-category totals required',targets:[]};
 const targets=comparison.rows.filter(x=>x.leader!=='OURS').map(row=>{
  const scale=scaleByCategory[row.category];
  const normalizedGap=finite(scale)&&scale>0?row.absoluteGap/scale:null;
  return {category:row.category,status:row.leader==='TIE'?'TIED':'TRAILING',gap:row.absoluteGap,normalizedGap,priorityVerified:normalizedGap!==null};
 });
 // Without calibrated category scales, never sort points vs percentages as if comparable.
 targets.sort((a,b)=>a.priorityVerified&&b.priorityVerified?a.normalizedGap-b.normalizedGap:a.priorityVerified?-1:b.priorityVerified?1:a.category.localeCompare(b.category));
 return {available:true,targets,probabilities:null,actionable:false,method:'Observed category margins; cross-category priority requires calibrated scales'};
}
export function streamingCalendar(candidates,{startDate,endDate,remainingAdds,occupiedSlots={}}={}){
 if(!Number.isInteger(remainingAdds)||remainingAdds<0)return {available:false,reason:'Verified remaining Yahoo acquisitions required',candidates:[]};
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(startDate||'')||!/^\\d{4}-\\d{2}-\\d{2}$/.test(endDate||'')||startDate>endDate)return {available:false,reason:'Valid calendar interval required',candidates:[]};
 if(!Array.isArray(candidates))return {available:false,reason:'Candidate list missing',candidates:[]};
 const valid=candidates.filter(c=>c&&c.ownership==='FREE_AGENT'&&c.ownershipVerified===true&&Array.isArray(c.scheduledGames)&&c.scheduledGames.every(d=>/^\\d{4}-\\d{2}-\\d{2}$/.test(d)));
 const ranked=valid.map(c=>{
  const dates=[...new Set(c.scheduledGames)].filter(d=>d>=startDate&&d<=endDate);
  const openDates=dates.filter(d=>!occupiedSlots[d]||occupiedSlots[d].includes?.(c.position));
  return {playerId:c.playerId,name:c.name,position:c.position,eligibleGames:openDates.length,dates:openDates,categoryImpact:null};
 }).sort((a,b)=>b.eligibleGames-a.eligibleGames||String(a.name).localeCompare(String(b.name)));
 return {available:true,candidates:ranked,remainingAdds,shortlist:ranked.slice(0,remainingAdds),categoryImpactVerified:false,actionable:false,method:'Schedule opportunities only; lineup and category projections not validated'};
}
function rate(fgm,fga){return fga>0?fgm/fga:null;}
export function tradeImpact({send=[],receive=[],rosterTotals}={}){
 const raw=['FGM','FGA','FTM','FTA','3PM','PTS','REB','AST','STL','BLK','TO'];
 if(!rosterTotals||!Array.isArray(send)||!Array.isArray(receive)||!send.length||!receive.length)return {available:false,reason:'Roster totals and both trade sides required'};
 const all=[rosterTotals,...send,...receive];
 if(all.some(p=>raw.some(k=>!finite(p?.[k])||p[k]<0)))return {available:false,reason:'Verified category projections and shooting attempts required'};
 const before=Object.fromEntries(raw.map(k=>[k,rosterTotals[k]]));
 const after=Object.fromEntries(raw.map(k=>[k,rosterTotals[k]-send.reduce((s,p)=>s+p[k],0)+receive.reduce((s,p)=>s+p[k],0)]));
 if(raw.some(k=>after[k]<0)||after.FGM>after.FGA||after.FTM>after.FTA)return {available:false,reason:'Trade would produce impossible totals'};
 const decorate=s=>({...s,'FG%':rate(s.FGM,s.FGA),'FT%':rate(s.FTM,s.FTA)});
 const a=decorate(before),b=decorate(after);
 return {available:true,before:a,after:b,changes:Object.fromEntries(NINE_CAT.map(k=>[k,a[k]===null||b[k]===null?null:b[k]-a[k]])),winProbability:null,actionable:false,method:'Deterministic projected nine-category delta; no opponent or uncertainty model'};
}
export function dataHealth(inputs,{now=Date.now()}={}){
 const checks=(inputs||[]).map(x=>{const age=freshness(x?.observedAt,{now,maxAgeMs:x?.maxAgeMs||300000});return {source:x?.name||'Unknown',status:x?.error?'ERROR':age.valid?'FRESH':x?.observedAt?'STALE':'MISSING',ageMs:age.ageMs,detail:x?.error||null};});
 return {checks,healthy:checks.length>0&&checks.every(c=>c.status==='FRESH'),readyForRecommendations:false};
}
