// Pure audit ledger: record forecasts when published; score ONLY after observed return.
const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const diff=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
export function recordForecast(history,entry){
 if(!entry?.source||!entry?.player||typeof entry.injuryEpisodeId!=='string'||!entry.injuryEpisodeId.trim()||
    !valid(entry.publishedAt)||!valid(entry.predictedReturn)||!entry.url)throw Error('Incomplete sourced forecast');
 if(diff(entry.predictedReturn,entry.publishedAt)<0)throw Error('Forecast must be recorded before predicted return');
 if(history.some(h=>h.forecastId===entry.forecastId)||!entry.forecastId)throw Error('Duplicate/missing forecast ID');
 return [...history,{...entry,actualReturn:null,actualEvidence:null}];
}
export function settleForecast(history,forecastId,{actualReturn,actualEvidence,verifiedAt}){
 if(!valid(actualReturn)||!valid(verifiedAt)||!actualEvidence)throw Error('Verified game appearance date and evidence required');
 const found=history.find(h=>h.forecastId===forecastId);
 if(!found||found.actualReturn)throw Error('Unknown/already settled forecast');
 if(diff(verifiedAt,actualReturn)<0||diff(actualReturn,found.publishedAt)<0)throw Error('Invalid chronology');
 return history.map(h=>h.forecastId===forecastId?{...h,actualReturn,actualEvidence,verifiedAt}:h);
}
export function sourceReliability(history,prior=0.5,priorWeight=10){
 const grouped=new Map();
 // One prediction per source per player return episode: first forecast only, not dozens of revisions.
 const unique=new Map();
 for(const h of history||[]){
  if(!h?.source||!h.player||!h.injuryEpisodeId||!valid(h.publishedAt)||!valid(h.predictedReturn))continue;
  const key=[h.source,h.player,h.injuryEpisodeId].join('|');
  const prev=unique.get(key);
  if(!prev||h.publishedAt<prev.publishedAt)unique.set(key,h);
 }
 // Only the first recorded prediction for an episode can contribute an accuracy sample.
 // A later settled revision must not replace an unsettled or incorrect first prediction.
 for(const h of unique.values()){
  if(!valid(h.actualReturn)||!valid(h.verifiedAt)||!h.actualEvidence||
     diff(h.actualReturn,h.publishedAt)<0||diff(h.verifiedAt,h.actualReturn)<0)continue;
  const g=grouped.get(h.source)||[];g.push(Math.abs(diff(h.predictedReturn,h.actualReturn)));grouped.set(h.source,g);
 }
 const result={};
 for(const [source,errors] of grouped){const n=errors.length,within3=errors.filter(d=>d<=3).length,meanError=errors.reduce((a,b)=>a+b,0)/n;
  result[source]={sampleSize:n,within3Days:within3,accuracyWithin3Days:within3/n,meanAbsoluteErrorDays:Math.round(meanError*100)/100,confidence:Math.round(((within3+prior*priorWeight)/(n+priorWeight))*1000)/1000,provisional:n<20};
 }
 return result;
}
