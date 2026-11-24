import {NINE_CAT} from './decision-core.mjs';
import {availableHistory,RAW_KEYS} from './sc3-forecast.mjs';
export const MODELS=['L3','L7','L10','L14','SEASON','EWMA','SHRINKAGE'];
const time=x=>Date.parse(x);
const pair={'FG%':['FGM','FGA'],'FT%':['FTM','FTA']};
export function modelWeights(n,model){
 if(!Number.isInteger(n)||n<1||!MODELS.includes(model))throw Error('Invalid model');
 const window=Number(model.slice(1));
 const w=Array.from({length:n},(_,i)=>{
  const age=n-1-i;
  if(model==='SEASON')return 1/n;
  if(model==='EWMA')return Math.pow(.5,age/5);
  if(model==='SHRINKAGE'){const k=Math.min(7,n),lambda=k/(k+10);return (1-lambda)/n+(age<k?lambda/k:0);}
  return age<window?1:0;
 });
 const total=w.reduce((a,b)=>a+b,0);return w.map(x=>x/total);
}
export function estimate(samples,weights,category){
 if(pair[category]){
  const [m,a]=pair[category];const attempts=samples.reduce((sum,s,i)=>sum+s[a]*weights[i],0);
  return attempts>0?samples.reduce((sum,s,i)=>sum+s[m]*weights[i],0)/attempts:null;
 }
 return samples.reduce((sum,s,i)=>sum+s[category]*weights[i],0);
}
export function compareModels(rows,{asOf,minimum=3}={}){
 const end=time(asOf);if(!Number.isFinite(end))throw Error('Invalid as-of');
 const usable=availableHistory(rows,asOf).filter(r=>r.espn_id&&r.event_id&&r.stats.MIN>0);
 const dates=[...new Set(usable.map(r=>new Date(time(r.tipoff)).toISOString().slice(0,10)))].sort();
 if(dates.length<8)return {available:false,reason:'Insufficient chronological days'};
 const validationStart=dates[Math.floor(dates.length*.5)],testStart=dates[Math.floor(dates.length*.75)];
 const validationTime=time(validationStart+'T00:00:00Z'),testTime=time(testStart+'T00:00:00Z');
 const groups=new Map(),seen=new Set();
 for(const r of usable){const k=r.espn_id+'|'+r.event_id;if(seen.has(k))throw Error('Duplicate outcome');seen.add(k);if(!groups.has(r.espn_id))groups.set(r.espn_id,[]);groups.get(r.espn_id).push(r);}
 const bucket=()=>Object.fromEntries(MODELS.map(m=>[m,Object.fromEntries(NINE_CAT.map(k=>[k,{n:0,weight:0,ae:0,se:0,brier:0,brierN:0}]))]));
 const metrics={validation:bucket(),test:bucket()},counts={training:0,validation:0,test:0,skipped:0};
 for(const games of groups.values()){
  games.sort((a,b)=>time(a.tipoff)-time(b.tipoff));
  for(let i=0;i<games.length;i++){
   const r=games[i],origin=time(r.tipoff);
   if(origin<validationTime){counts.training++;continue;}
   const phase=origin<testTime?'validation':'test';
   // Validation labels themselves must have been observed before the test boundary.
   if(phase==='validation'&&time(r.observed_at)>=testTime){counts.skipped++;continue;}
   const samples=games.slice(0,i).filter(g=>time(g.tipoff)<origin&&time(g.observed_at)<origin).map(g=>g.stats);
   if(samples.length<minimum){counts.skipped++;continue;}
   counts[phase]++;
   const weights=Object.fromEntries(MODELS.map(m=>[m,modelWeights(samples.length,m)]));
   for(const k of NINE_CAT){
    const [made,attempt]=pair[k]??[];
    if(attempt&&r.stats[attempt]===0)continue;
    const y=attempt?r.stats[made]/r.stats[attempt]:r.stats[k];
    const estimates=MODELS.map(m=>estimate(samples,weights[m],k));
    if(estimates.some(x=>x===null||!Number.isFinite(x)))continue; // identical comparison set
    const threshold=estimates[4],weight=attempt?r.stats[attempt]:1;
    for(let j=0;j<MODELS.length;j++){
     const m=MODELS[j],v=metrics[phase][m][k],error=estimates[j]-y;
     v.n++;v.weight+=weight;v.ae+=Math.abs(error)*weight;v.se+=error*error*weight;
     // Probability of exceeding pre-origin season mean; zero-attempt draws are undefined.
     let eligible=0,above=0;
     samples.forEach((s,i)=>{if(attempt&&!s[attempt])return;const w=weights[m][i];eligible+=w;if((attempt?s[made]/s[attempt]:s[k])>threshold)above+=w;});
     if(eligible>0){v.brier+=(above/eligible-Number(y>threshold))**2;v.brierN++;}
    }
   }
  }
 }
 const summarize=phase=>Object.fromEntries(MODELS.map(m=>[m,Object.fromEntries(NINE_CAT.map(k=>{const v=metrics[phase][m][k];return [k,{n:v.n,mae:v.weight?v.ae/v.weight:null,rmse:v.weight?Math.sqrt(v.se/v.weight):null,brier:v.brierN?v.brier/v.brierN:null}]}))]));
 const validation=summarize('validation'),test=summarize('test');
 // Pick one whole-vector model, not a different model for each statistic.
 const score=m=>{const ratios=NINE_CAT.map(k=>{const base=validation.SEASON[k].mae,err=validation[m][k].mae;return base>0&&err!==null?err/base:null;});return ratios.every(v=>v!==null)?ratios.reduce((a,b)=>a+b,0)/ratios.length:null;};
 const ranking=MODELS.map(model=>({model,score:score(model)})).filter(x=>x.score!==null).sort((a,b)=>a.score-b.score||a.model.localeCompare(b.model));
 const selected=ranking[0]?.model??null;
 return {available:!!selected&&counts.test>0,asOf,validationStart,testStart,counts,athletes:groups.size,validation,test,ranking,selected,selection:'validation normalized MAE only; frozen for test',method:'Rolling origin; windows up to N observed appearances, EWMA half-life 5, shrinkage recent 7 toward own season with 10 pseudo-games. FG%/FT% ratios of weighted makes/attempts; errors weighted by actual attempts.',calibratesMatchup:false,readOnly:true};
}
