const CAT=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
const COUNT=['3PM','PTS','REB','AST','STL','BLK','TO','FGM','FGA','FTM','FTA'];
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const numeric=o=>o&&COUNT.every(k=>finite(o[k])&&o[k]>=0);
const fail=s=>{throw new Error(s)};
const tidy=x=>Math.round(x*10000)/10000;
export function verifyDataset(d,{now=new Date().toISOString(),maxAgeHours=48}={}){
 if(!d||!d.provenance||!d.provenance.observedAt||!d.provenance.source)fail('Source and observation time required');
 const t=Date.parse(d.provenance.observedAt),current=Date.parse(now);
 if(!Number.isFinite(t)||t>current+300000)fail('Invalid/future observation time');
 const age=(current-t)/3600000;
 if(!Array.isArray(d.roster)||!Array.isArray(d.freeAgents)||!Array.isArray(d.schedule))fail('Missing roster, freeAgents or schedule');
 const playerIds=[...d.roster,...d.freeAgents].map(p=>p.id);
 if(playerIds.some(x=>typeof x!=='string'||!x)||new Set(playerIds).size!==playerIds.length)fail('Missing or duplicate player IDs');
 if(d.roster.some(p=>!Array.isArray(p.positions)||!numeric(p.projection))||d.freeAgents.some(p=>!Array.isArray(p.positions)||!numeric(p.projection)))fail('Invalid player projections');
 if(!d.schedule.every(s=>typeof s.playerId==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s.date)))fail('Invalid schedule');
 return {valid:true,ageHours:tidy(age),fresh:age<=maxAgeHours,liveYahooVerified:d.provenance.yahooOwnershipVerified===true,source:d.provenance.source,observedAt:d.provenance.observedAt,actionable:age<=maxAgeHours&&d.provenance.yahooOwnershipVerified===true&&d.provenance.scheduleVerified===true&&d.provenance.projectionsVerified===true};
}
function eligible(pos,slot){return slot==='UTIL'||pos.includes(slot)||(slot==='G'&&(pos.includes('PG')||pos.includes('SG')))||(slot==='F'&&(pos.includes('SF')||pos.includes('PF')))||(slot==='FC'&&(pos.includes('PF')||pos.includes('C')))}
function lineupDP(players,slots,metric){
 if(slots.length>15)fail('Maximum 15 lineup slots');
 let dp=new Map([[0,{score:0,items:[]}]]);
 for(const p of players){const next=new Map(dp);
  for(const [mask,v] of dp)for(let i=0;i<slots.length;i++){
   if(mask&(1<<i)||!eligible(p.positions,slots[i]))continue;
   const mask2=mask|(1<<i),score=v.score+metric(p);
   if(!next.has(mask2)||score>next.get(mask2).score)next.set(mask2,{score,items:[...v.items,{slot:slots[i],playerId:p.id,name:p.name}]});
  }dp=next;
 }
 return [...dp.values()].sort((a,b)=>b.items.length-a.items.length||b.score-a.score)[0]||{score:0,items:[]};
}
function value(p,weights){const s=p.projection;return CAT.reduce((v,k)=>{
  const raw=k==='FG%'?(s.FGM-.47*s.FGA)/5:k==='FT%'?(s.FTM-.78*s.FTA)/3:(k==='TO'?-s.TO:s[k]);
  return v+(weights[k]??1)*raw/(k==='PTS'?20:k==='REB'?8:k==='AST'?5:k==='STL'?2:k==='BLK'?2:k==='3PM'?3:2);
},0)}
export function optimalLineup({players,slots,weights={}}){
 if(!Array.isArray(players)||!Array.isArray(slots))fail('players and slots required');
 return lineupDP(players,slots,p=>value(p,weights));
}
export function projectedTeamTotals({players,schedule,dates,slots,weights={}}){
 const totals=Object.fromEntries(COUNT.map(k=>[k,0]));const lineups=[];
 for(const date of dates){
  const active=players.filter(p=>!['OUT','INJ','SUSP','IL'].includes(String(p.injuryStatus||'').toUpperCase())&&schedule.some(g=>g.playerId===p.id&&g.date===date));
  const lineup=optimalLineup({players:active,slots,weights});
  lineups.push({date,...lineup});
  for(const x of lineup.items){const p=players.find(q=>q.id===x.playerId);for(const k of COUNT)totals[k]+=p.projection[k]}
 }
 totals['FG%']=totals.FGA?100*totals.FGM/totals.FGA:null;
 totals['FT%']=totals.FTA?100*totals.FTM/totals.FTA:null;
 return {totals,lineups,starts:lineups.reduce((s,l)=>s+l.items.length,0)};
}
export function streamingOptions({roster,freeAgents,schedule,dates,slots,weights={},addsRemaining}){
 if(!Number.isInteger(addsRemaining)||addsRemaining<0)fail('Verified addsRemaining required');
 if(addsRemaining===0)return [];
 const baseline=projectedTeamTotals({players:roster,schedule,dates,slots,weights});
 const results=[];
 for(const add of freeAgents.filter(p=>p.availability==='FA'&&p.liveYahooVerified===true)){
  for(const drop of roster.filter(p=>p.canCutVerified===true&&!p.keeperProtected)){
   const next=projectedTeamTotals({players:[...roster.filter(p=>p.id!==drop.id),add],schedule,dates,slots,weights});
   const baselineScore=baseline.lineups.reduce((s,x)=>s+x.score,0);
   const nextScore=next.lineups.reduce((s,x)=>s+x.score,0);
   results.push({add:add.name,drop:drop.name,gain:tidy(nextScore-baselineScore),additionalStarts:next.starts-baseline.starts,requiresApproval:true,executable:false});
  }
 }
 return results.sort((a,b)=>b.gain-a.gain).slice(0,20);
}
const erf=x=>{let sign=x<0?-1:1;x=Math.abs(x);const t=1/(1+.3275911*x);const y=1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x);return sign*y};
const normalCdf=z=>.5*(1+erf(z/Math.SQRT2));
export function matchupProbabilities({ours,theirs,uncertainty}){
 const out={};let expectedWins=0;
 for(const cat of CAT){
  if(!finite(ours[cat])||!finite(theirs[cat])||!finite(uncertainty[cat])||uncertainty[cat]<=0)fail('Matchup requires documented projections and positive uncertainty for '+cat);
  const z=(cat==='TO'?theirs[cat]-ours[cat]:ours[cat]-theirs[cat])/uncertainty[cat];
  const probability=tidy(normalCdf(z));out[cat]=probability;expectedWins+=probability;
 }
 return {categories:out,expectedCategoryWins:tidy(expectedWins),method:'Normal approximation on category margins; illustrative unless uncertainty is empirically calibrated',isGuaranteed:false};
}
export const rosterSlots=['PG','SG','G','SF','PF','F','C','FC','UTIL','UTIL'];
