import {gameWindows,performanceTrend} from './nba-game-logs.mjs';
import {zScores} from './fantasy-zscore.mjs';
import {matchPlayers} from './player-identity.mjs';
export function buildPerformance(logs,{asOf,historyComplete=false}={}){
 if(!historyComplete||!Array.isArray(logs)||!logs.length||!asOf||!Number.isFinite(Date.parse(asOf)))return {available:false,reason:'Complete dated history required'};
 const groups=new Map();
 for(const row of logs){if(!row.espnId||!row.eventId||!Number.isFinite(Date.parse(row.date))||Date.parse(row.date)>Date.parse(asOf))continue;if(!groups.has(row.espnId))groups.set(row.espnId,[]);groups.get(row.espnId).push(row)}
 const players=[];
 for(const [id,rows] of groups){
 const unique=[...new Map(rows.map(r=>[r.eventId,r])).values()].sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
 const windows=gameWindows(unique,{asOf:new Date(asOf),windows:[...new Set([1,3,7,14,unique.length])]});
 const season=windows[unique.length],recent=Object.fromEntries([1,3,7,14].map(n=>[n,windows[n]]));
 const prior=unique.slice(3,14);
 const base=prior.length>=5?gameWindows(prior,{asOf:new Date(asOf),windows:[prior.length]})[prior.length]:null;
 const last=recent[3];let signal='insufficient';
 const delta=base&&last.complete&&Number.isFinite(last.values.MPG)&&Number.isFinite(base.values.MPG)?last.values.MPG-base.values.MPG:null;
 const cats=['PTS','REB','AST','STL','BLK','3PM'];
 const improved=base?cats.filter(k=>Number.isFinite(last.values[k])&&Number.isFinite(base.values[k])&&last.values[k]-base.values[k]>=Math.max(.5,base.values[k]*.15)).length:0;
 const declined=base?cats.filter(k=>Number.isFinite(last.values[k])&&Number.isFinite(base.values[k])&&base.values[k]-last.values[k]>=Math.max(.5,base.values[k]*.15)).length:0;
 if(delta!==null)signal=delta>=4&&improved>=2?'breakout_watch':delta<=-4&&declined>=2?'decline_watch':'stable_or_mixed';
 players.push({id:String(id),name:unique[0].name,team:unique[0].team,season,windows:recent,trends:performanceTrend(recent,season.values),signal:{type:signal,minutesDelta:delta,improved,declined,baselineGames:prior.length,actionable:false},chart:unique.slice(0,14).reverse().map(r=>({date:r.date,stats:r.stats}))});
 }
 const ranked=zScores(players.map(p=>({id:p.id,values:p.season.values})),{expectedPoolSize:players.length});
 const ranks=new Map((ranked.rows||[]).map((r,i)=>[r.id,{rank:Number.isFinite(r.total)?i+1:null,total:r.total,categories:r.categories,pool:ranked.eligible}]));
 return {available:true,asOf,source:'ESPN completed regular-season box scores',pool:players.length,rankingAvailable:ranked.available,players:players.map(p=>({...p,z:ranks.get(p.id)||null})),actionable:false};
}
export function attachPerformance(yahoo,espnIdentities,report){
 const links=matchPlayers(yahoo,espnIdentities),byId=new Map((report.players||[]).map(p=>[p.id,p]));
 return links.map(l=>({...l,performance:l.status==='verified'?byId.get(l.espnId)||null:null}));
}
