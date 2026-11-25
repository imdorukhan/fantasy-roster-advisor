import {NINE_CAT} from './decision-core.mjs';
// Predeclared operational thresholds, not a claim of statistical significance.
export const PROMOTION_POLICY=Object.freeze({version:'p22-policy-v1',validationAppearances:500,testAppearances:500,validationDays:14,testDays:14,categorySamples:200,minimumRelativeGain:.02,maxCategoryDegradation:.05,incumbent:'L10',baseline:'SEASON'});
const average=a=>a.reduce((s,v)=>s+v,0)/a.length;
function ratio(candidate,base,metric){
 const values=NINE_CAT.map(k=>{const a=candidate?.[k]?.[metric],b=base?.[k]?.[metric];return Number.isFinite(a)&&Number.isFinite(b)&&b>0?a/b:null;});
 return values.every(v=>v!==null)?values:null;
}
export function modelPromotion(comparison){
 const p=PROMOTION_POLICY,reasons=[],model=comparison?.selected,counts=comparison?.counts;
 if(!comparison?.available||comparison.exploratory||comparison.split!=='calendar')reasons.push('Prospectively fixed calendar validation required; exploratory split cannot promote');
 if(!model||model===p.incumbent)reasons.push('No eligible challenger');
 if((counts?.validation??0)<p.validationAppearances||(counts?.test??0)<p.testAppearances)reasons.push('Minimum 500 validation and 500 test appearances');
 if((comparison?.phaseDays?.validation??0)<p.validationDays||(comparison?.phaseDays?.test??0)<p.testDays)reasons.push('Minimum 14 distinct scored days in each phase');
 for(const phase of ['validation','test'])if(NINE_CAT.some(k=>(comparison?.[phase]?.[model]?.[k]?.n??0)<p.categorySamples))reasons.push('Minimum 200 common observations per category in '+phase);
 for(const ref of [p.incumbent,p.baseline]){
  const v=ratio(comparison?.validation?.[model],comparison?.validation?.[ref],'mae'),t=ratio(comparison?.test?.[model],comparison?.test?.[ref],'mae'),b=ratio(comparison?.test?.[model],comparison?.test?.[ref],'brier');
  if(!v||average(v)>1-p.minimumRelativeGain)reasons.push('Validation MAE gain below 2% versus '+ref);
  if(!t||average(t)>1||t.some(x=>x>1+p.maxCategoryDegradation))reasons.push('Held-out MAE or category deterioration versus '+ref);
  if(!b||average(b)>1)reasons.push('Held-out Brier degradation versus '+ref);
 }
 return {policy:p,challenger:model??null,incumbent:p.incumbent,eligible:reasons.length===0,requiresOwnerApproval:true,calibratesMatchup:false,reasons:[...new Set(reasons)]};
}
