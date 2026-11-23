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
 const required=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
 const categories=Object.keys(categoryWinProbabilities||{});
 if(categories.length!==required.length||required.some(k=>!Object.hasOwn(categoryWinProbabilities,k))||
    !required.includes(puntCategory)||required.some(k=>!numeric(categoryWinProbabilities[k])||categoryWinProbabilities[k]<0||categoryWinProbabilities[k]>1))
  throw Error('Nine official 9-CAT probabilities required');
 const retained=required.filter(k=>k!==puntCategory);
 return {puntCategory,retainedExpectedWins:tidy(retained.reduce((s,k)=>s+categoryWinProbabilities[k],0)),
  targetWins:5,winProbability:null,calibrated:false,actionable:false,requiresApproval:true,
  note:'Scenario arithmetic only. Inputs are not verified or calibrated. Ignoring a category does not redistribute wins. Re-run matchup model with verified revised roster projections to evaluate an actual punt.'};
}
export function playoffScheduleValue({players,schedule,dates}){
 if(!Array.isArray(players)||!Array.isArray(schedule)||!Array.isArray(dates))throw Error('Invalid playoff window');
 const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&
  Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 if(!dates.length||dates.some(d=>!validDay(d))||new Set(dates).size!==dates.length)throw Error('Valid playoff dates required');
 if(players.some(p=>!p||!p.id)||new Set(players.map(p=>String(p.id))).size!==players.length)throw Error('Unique player IDs required');
 if(schedule.some(g=>!g||!g.playerId||!validDay(g.date)))throw Error('Valid schedule rows required');
 const dateSet=new Set(dates);
 return players.map(p=>{
  const games=new Set(schedule.filter(g=>String(g.playerId)===String(p.id)&&dateSet.has(g.date)&&g.cancelled!==true)
   .map(g=>String(g.eventId??'')?g.date+'|'+String(g.eventId):g.date));
  return {name:p.name,games:games.size,scheduleVerified:false,actionable:false,
   method:'Supplied schedule scenario only; official Yahoo playoff weeks and complete NBA coverage are not independently verified'};
 }).sort((a,b)=>b.games-a.games||String(a.name).localeCompare(String(b.name)));
}
export function forecastError({predictions,outcomes}){
 const seen=new Set();const rows=[];
 for(const p of predictions||[]){if(!p.id||seen.has(p.id)||!numeric(p.predicted))continue;seen.add(p.id);const a=outcomes?.[p.id];if(!numeric(a))continue;rows.push({id:p.id,absoluteError:tidy(Math.abs(p.predicted-a))})}
 return {samples:rows.length,meanAbsoluteError:rows.length?tidy(rows.reduce((s,x)=>s+x.absoluteError,0)/rows.length):null,provisional:rows.length<20};
}
export function alertCandidates({myRoster=[],verifiedFreeAgents=[],news=[],now=Date.now(),deliveredEventKeys=[]}={}){
 if(!Array.isArray(myRoster)||!Array.isArray(verifiedFreeAgents)||!Array.isArray(news)||!Array.isArray(deliveredEventKeys))throw Error('Verified alert inputs required');
 const instant=typeof now==='number'?now:Date.parse(now);
 if(!Number.isFinite(instant))throw Error('Valid alert check time required');
 const own=new Set(myRoster.filter(p=>p?.liveYahooVerified===true&&(p.ownership==='MY_TEAM'||p.availability==='MY_TEAM')).map(p=>String(p.id)));
 const fa=new Set(verifiedFreeAgents.filter(p=>p?.liveYahooVerified===true&&p.availability==='FA').map(p=>String(p.id)));
 const seen=new Set(deliveredEventKeys.map(String)),results=[];
 const sourceUrlValid=raw=>{
  try{
   const url=new URL(raw);
   return url.protocol==='https:'&&Boolean(url.hostname)&&!url.username&&!url.password&&url.pathname!=='/';
  }catch{return false;}
 };
 for(const n of news){
  const id=String(n?.playerId??''),age=instant-Date.parse(n?.observedAt);
  const inOwn=own.has(id),inFa=fa.has(id);
  if(!id||inOwn===inFa||n?.important!==true||n.verifiedSource!==true||
     typeof n.message!=='string'||!n.message.trim()||n.message.length>300||
     !Number.isFinite(age)||age< -60_000||age>72*3600000||
     !sourceUrlValid(n.sourceUrl))continue;
  const episode=typeof n.injuryEpisodeId==='string'&&/^[a-z0-9_-]{1,128}$/i.test(n.injuryEpisodeId)
   ?n.injuryEpisodeId:null;
  const injuryStatus=typeof n.injuryStatus==='string'&&/^[a-z0-9_-]{1,30}$/i.test(n.injuryStatus)
   ?n.injuryStatus.toUpperCase():null;
  // A new article, URL or timestamp is not a new injury state.
  const key=episode&&injuryStatus?id+'|'+episode+'|'+injuryStatus
   :id+'|'+n.sourceUrl+'|'+n.message.trim().toLowerCase();
  if(seen.has(key))continue;
  seen.add(key);
  results.push({playerId:id,scope:inOwn?'MY_TEAM':'VERIFIED_FA',
   message:n.message,sourceUrl:n.sourceUrl,observedAt:n.observedAt,eventKey:key,
   sourceVerified:true,requiresApproval:true,executable:false,deliveryEnabled:false});
 }
 return results;
}
