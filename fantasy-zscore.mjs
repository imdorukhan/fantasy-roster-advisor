// Descriptive Z-scores over an explicit, sufficiently covered comparison pool.
export const CATEGORIES=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
export function zScores(players,{minPool=30,expectedPoolSize,minimumCoverage=.9,punt=[]}={}){
 if(!Array.isArray(players)||!Number.isInteger(expectedPoolSize)||expectedPoolSize<minPool||!Number.isFinite(minimumCoverage)||minimumCoverage<=0||minimumCoverage>1)return {available:false,reason:'Explicit comparison pool required'};
 if(!Array.isArray(punt)||new Set(punt).size!==punt.length||punt.some(k=>!CATEGORIES.includes(k)))return {available:false,reason:'Punt category list must use unique official 9-CAT keys'};
 const required=['FGM','FGA','FTM','FTA','3PM','PTS','REB','AST','STL','BLK','TO'];
 const identifiable=players.filter(p=>p?.id!==null&&p?.id!==undefined);
 const ids=identifiable.map(p=>String(p.id));
 if(new Set(ids).size!==ids.length)return {available:false,reason:'Duplicate player identities in comparison pool'};
 const eligible=identifiable.filter(p=>required.every(k=>finite(p.values?.[k]))&&
   p.values.FGM<=p.values.FGA&&p.values.FTM<=p.values.FTA&&p.values['3PM']<=p.values.FGM);
 if(eligible.length<minPool||eligible.length>expectedPoolSize||eligible.length/expectedPoolSize<minimumCoverage)return {available:false,reason:'Insufficient verified pool coverage',eligible:eligible.length,expectedPoolSize};
 const fgAttempts=eligible.reduce((s,p)=>s+p.values.FGA,0),ftAttempts=eligible.reduce((s,p)=>s+p.values.FTA,0);
 if(!fgAttempts||!ftAttempts)return {available:false,reason:'Missing shooting volume'};
 const fg=eligible.reduce((s,p)=>s+p.values.FGM,0)/fgAttempts,ft=eligible.reduce((s,p)=>s+p.values.FTM,0)/ftAttempts;
 const vectors=eligible.map(p=>({id:String(p.id),values:{...p.values,'FG%':p.values.FGM-fg*p.values.FGA,'FT%':p.values.FTM-ft*p.values.FTA,TO:-p.values.TO}}));
 const moments=Object.fromEntries(CATEGORIES.map(k=>{const a=vectors.map(p=>p.values[k]),m=mean(a);return [k,{mean:m,sd:Math.sqrt(mean(a.map(x=>(x-m)**2)))}]}));
 const active=CATEGORIES.filter(k=>!punt.includes(k));
 if(!active.length)return {available:false,reason:'All categories excluded'};
 const rows=vectors.map(p=>{const categories=Object.fromEntries(CATEGORIES.map(k=>[k,moments[k].sd>0?(p.values[k]-moments[k].mean)/moments[k].sd:null]));const total=active.every(k=>categories[k]!==null)?active.reduce((s,k)=>s+categories[k],0):null;return {id:p.id,categories,total}});
 rows.sort((a,b)=>(b.total??-Infinity)-(a.total??-Infinity)||a.id.localeCompare(b.id));
 return {available:true,eligible:eligible.length,expectedPoolSize,coverage:eligible.length/expectedPoolSize,baseline:{fg,ft},moments,punt,rows,method:'Per-game 9-CAT; percentages use excess made shots versus volume-weighted pool baseline; turnover sign reversed; equal category weights',actionable:false};
}
