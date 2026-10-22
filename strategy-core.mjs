const numeric=n=>typeof n==='number'&&Number.isFinite(n);
const tidy=x=>Math.round(x*100)/100;
export function breakoutCandidates({players,lookbackGames=7}){
 if(!Array.isArray(players))throw Error('players required');
 return players.filter(p=>p.availability==='FA'&&p.liveYahooVerified===true&&Array.isArray(p.recentGames)&&p.recentGames.length>=Math.min(5,lookbackGames)&&numeric(p.baselineMinutes)&&p.baselineMinutes>0).map(p=>{
  const games=p.recentGames.slice(-lookbackGames),minutes=games.reduce((s,g)=>s+g.minutes,0)/games.length;
  const increase=minutes/p.baselineMinutes-1;
  return {name:p.name,minutesIncreasePercent:tidy(100*increase),watch:increase>=.25,minutesLastGames:tidy(minutes),requiresApproval:true,executable:false};
 }).filter(p=>p.watch).sort((a,b)=>b.minutesIncreasePercent-a.minutesIncreasePercent);
}
export function fabPlan({budget,weeksLeft,claims}){
 if(!Number.isInteger(budget)||budget<0||!Number.isInteger(weeksLeft)||weeksLeft<1||!Array.isArray(claims))throw Error('Invalid FAB plan');
 return claims.filter(x=>x.availableVerified===true&&numeric(x.estimatedValue)&&x.estimatedValue>=0).map(x=>{
  const baseline=budget/weeksLeft;
  const allowance=Math.min(budget,Math.floor(baseline*Math.min(3,Math.max(.25,x.estimatedValue))));
  return {player:x.name,suggestedMaxBid:allowance,bidRequiresApproval:true,executable:false,method:'Heuristic planning ceiling, not an auction-winning bid prediction'};
 }).sort((a,b)=>b.suggestedMaxBid-a.suggestedMaxBid);
}
export function puntSimulation({categoryWinProbabilities,puntCategory}){
 const categories=Object.keys(categoryWinProbabilities||{});
 if(categories.length!==9||!categories.includes(puntCategory)||categories.some(k=>!numeric(categoryWinProbabilities[k])||categoryWinProbabilities[k]<0||categoryWinProbabilities[k]>1))throw Error('Nine valid probabilities and punt category required');
 const retained=categories.filter(k=>k!==puntCategory);
 return {puntCategory,retainedExpectedWins:tidy(retained.reduce((s,k)=>s+categoryWinProbabilities[k],0)),targetWins:5,note:'Ignoring a category does not redistribute wins. Re-run matchup model with revised roster projections to evaluate an actual punt.'};
}
export function playoffScheduleValue({players,schedule,dates}){
 if(!Array.isArray(players)||!Array.isArray(schedule)||!Array.isArray(dates))throw Error('Invalid playoff window');
 return players.map(p=>({name:p.name,games:schedule.filter(g=>g.playerId===p.id&&dates.includes(g.date)).length})).sort((a,b)=>b.games-a.games);
}
export function forecastError({predictions,outcomes}){
 const seen=new Set();const rows=[];
 for(const p of predictions||[]){if(!p.id||seen.has(p.id)||!numeric(p.predicted))continue;seen.add(p.id);const a=outcomes?.[p.id];if(!numeric(a))continue;rows.push({id:p.id,absoluteError:tidy(Math.abs(p.predicted-a))})}
 return {samples:rows.length,meanAbsoluteError:rows.length?tidy(rows.reduce((s,x)=>s+x.absoluteError,0)/rows.length):null,provisional:rows.length<20};
}
export function alertCandidates({myRoster,verifiedFreeAgents,news}){
 const known=new Map([...myRoster.map(p=>[p.id,'MY_TEAM']),...verifiedFreeAgents.filter(p=>p.availability==='FA'&&p.liveYahooVerified===true).map(p=>[p.id,'VERIFIED_FA'])]);
 return (news||[]).filter(n=>known.has(n.playerId)&&n.important===true&&n.verifiedSource===true).map(n=>({playerId:n.playerId,scope:known.get(n.playerId),message:n.message,requiresApproval:true,executable:false}));
}
