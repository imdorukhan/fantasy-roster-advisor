// Pure Yahoo 9-CAT completeness audit. Read-only; never infer missing values.
// Per-game shooting makes/attempts are displayed to one decimal place by Yahoo,
// whereas shooting percentages have additional precision; audit the resulting
// intervals rather than comparing rounded ratios as if they were exact totals.
export const REQUIRED_NINE_CAT=Object.freeze(['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO']);
const SHOOTING=Object.freeze(['FGM','FGA','FTM','FTA']);
const rateConsistent=(made,attempts,percent,coverage)=>{
 const average=coverage==='average_season';
 const rounding=average?.05:0;
 if(attempts<=0||made>attempts+rounding*2+1e-9)return false;
 const minRate=Math.max(0,made-rounding)/(attempts+rounding);
 const maxRate=attempts-rounding>0?Math.min(1,(made+rounding)/(attempts-rounding)):1;
 // Yahoo's percentage source is typically displayed to 3 decimal places.
 const pctRounding=.00051;
 return percent>=minRate-pctRounding&&percent<=maxRate+pctRounding;
};
export function assessYahooNineCat(values,{coverage='season'}={}){
 const required=[...REQUIRED_NINE_CAT,...SHOOTING];
 const missing=required.filter(k=>!Number.isFinite(values?.[k]));
 const invalid=[];
 for(const k of required){
  const n=values?.[k];
  if(Number.isFinite(n)&&(n<0||((k==='FG%'||k==='FT%')&&n>1)))invalid.push(k);
 }
 if(!missing.length){
  if(!rateConsistent(values.FGM,values.FGA,values['FG%'],coverage))invalid.push('FG%');
  if(!rateConsistent(values.FTM,values.FTA,values['FT%'],coverage))invalid.push('FT%');
  if(values['3PM']>values.FGM+(coverage==='average_season'?.1:0)+1e-9)invalid.push('3PM');
 }
 return {ready:missing.length===0&&invalid.length===0,missing,invalid:[...new Set(invalid)],
  method:'Yahoo 9-CAT shooting-volume evidence, rounding-aware per-game rates; not a calibrated forecast'};
}
