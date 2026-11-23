// Pure Yahoo 9-CAT completeness audit. Returned player IDs and model-ready stat
// coverage are distinct; never infer missing Yahoo fields from ESPN values.
export const REQUIRED_NINE_CAT=Object.freeze(['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO']);
const SHOOTING=Object.freeze(['FGM','FGA','FTM','FTA']);
export function assessYahooNineCat(values){
 const required=[...REQUIRED_NINE_CAT,...SHOOTING];
 const missing=required.filter(k=>!Number.isFinite(values?.[k]));
 const invalid=[];
 for(const k of required){
  const n=values?.[k];
  if(Number.isFinite(n)&&(n<0||((k==='FG%'||k==='FT%')&&n>1)))invalid.push(k);
 }
 if(!missing.length){
  if(values.FGM>values.FGA||values.FGA<=0||Math.abs(values.FGM/values.FGA-values['FG%'])>.015)invalid.push('FG%');
  if(values.FTM>values.FTA||values.FTA<=0||Math.abs(values.FTM/values.FTA-values['FT%'])>.015)invalid.push('FT%');
  if(values['3PM']>values.FGM)invalid.push('3PM');
 }
 return {ready:missing.length===0&&invalid.length===0,missing,invalid:[...new Set(invalid)],
  method:'Yahoo 9-CAT and shooting-volume evidence, not a calibrated forecast'};
}
