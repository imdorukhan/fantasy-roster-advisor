// Offline, read-only quality audit of prospective Yahoo 9-CAT forecasts.
// It does not fit or activate a predictive model.
const CAT=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
const iso=value=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)&&
 Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,19)===value.slice(0,19);
const blocked=(status,reason,heldoutWeeks=0)=>({
 status,reason,heldoutWeeks,evaluatedCategories:0,brierScore:null,logLoss:null,
 calibrated:false,actionable:false,winProbability:null,readOnly:true
});
export function auditHeldoutCategories(records,{minimumWeeks=8,minimumCategories=72}={}){
 if(!Array.isArray(records)||!Number.isInteger(minimumWeeks)||minimumWeeks<1||
    !Number.isInteger(minimumCategories)||minimumCategories<9)
  return blocked('unverified','Invalid held-out assessment inputs');
 if(!records.length)return blocked('insufficient_heldout','No observed forecasts and outcomes');
 const byFixture=new Map(),forecastIds=new Set(),activeWeeks=new Set();
 for(const row of records){
  if(!row||row.leagueId!==85892||!Number.isInteger(row.week)||row.week<1||
     !Number.isInteger(row.teamId)||!Number.isInteger(row.opponentId)||
     row.teamId===row.opponentId||!CAT.includes(row.category)||
     !row.forecastId||forecastIds.has(row.forecastId)||
     !Number.isFinite(row.predictedWinProbability)||row.predictedWinProbability<0||
     row.predictedWinProbability>1||!['WIN','LOSS','TIE'].includes(row.outcome)||
     row.source!=='Yahoo Fantasy Sports API'||row.scoreVerified!==true||
     ![row.issuedAt,row.featuresThroughAt,row.weekStartAt,row.weekEndAt,row.outcomeObservedAt].every(iso))
   return blocked('unverified','Invalid or unverified Yahoo 9-CAT forecast row');
  const [issued,features,start,end,observed]=
   [row.issuedAt,row.featuresThroughAt,row.weekStartAt,row.weekEndAt,row.outcomeObservedAt].map(Date.parse);
  if(!(features<=issued&&issued<start&&start<end&&end<observed&&
       end-start>5*86400000&&end-start<=7*86400000))
   return blocked('unverified','Prediction leakage or invalid forecast chronology');
  forecastIds.add(row.forecastId);
  activeWeeks.add(row.week);
  const key=[row.leagueId,row.week,row.teamId,row.opponentId].join('|');
  const group=byFixture.get(key)||new Map();
  if(group.has(row.category))return blocked('unverified','Duplicate 9-CAT forecast for a fixture');
  group.set(row.category,row);
  byFixture.set(key,group);
 }
 for(const group of byFixture.values()){
  if(group.size!==CAT.length||CAT.some(cat=>!group.has(cat)))
   return blocked('unverified','All nine Yahoo categories required per observed fixture');
 }
 const usable=[...byFixture.values()].flatMap(group=>[...group.values()])
  .filter(r=>r.outcome!=='TIE');
 if(activeWeeks.size<minimumWeeks||usable.length<minimumCategories)
  return blocked('insufficient_heldout','Not enough held-out weeks or fully observed category results',activeWeeks.size);
 const brier=usable.reduce((sum,r)=>{
  const y=r.outcome==='WIN'?1:0;return sum+(r.predictedWinProbability-y)**2;
 },0)/usable.length;
 const logLoss=usable.reduce((sum,r)=>{
  const p=Math.min(1-1e-12,Math.max(1e-12,r.predictedWinProbability));
  return sum-(r.outcome==='WIN'?Math.log(p):Math.log(1-p));
 },0)/usable.length;
 return {status:'review_only',reason:'Descriptive held-out audit, not calibrated or approved for action',
  heldoutWeeks:activeWeeks.size,evaluatedCategories:usable.length,
  brierScore:Number(brier.toFixed(5)),logLoss:Number(logLoss.toFixed(5)),
  calibrated:false,actionable:false,winProbability:null,readOnly:true};
}
