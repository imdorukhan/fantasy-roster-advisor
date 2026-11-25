import {createHash} from 'node:crypto';
import {NINE_CAT,categoryComparison} from './decision-core.mjs';
import {teamCode} from './sc3-depth-store.mjs';
import {MODELS,modelWeights} from './sc3-model-weights.mjs';
export const MODEL_VERSION='sc3-bootstrap-v2';
export const RAW_KEYS=['3PM','PTS','REB','AST','STL','BLK','TO','FGM','FGA','FTM','FTA'];
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T12:00Z'))&&new Date(x+'T12:00Z').toISOString().slice(0,10)===x;
export const validBox=s=>RAW_KEYS.every(k=>Number.isSafeInteger(s?.[k])&&s[k]>=0)&&s.FGM<=s.FGA&&s.FTM<=s.FTA&&s['3PM']<=s.FGM;
const stamp=x=>Date.parse(x);
const rate=(m,a)=>a?Math.round(m/a*1000)/1000:null;
function random(seed){let t=seed>>>0;return()=>{t=(t+0x6D2B79F5)>>>0;let v=t;v=Math.imul(v^(v>>>15),v|1);v^=v+Math.imul(v^(v>>>7),v|61);return ((v^(v>>>14))>>>0)/4294967296;};}
const raw=t=>Object.fromEntries(RAW_KEYS.map(k=>[k,t.shooting?.[k]??t.stats?.[k]]));
const totals=r=>({...r,'FG%':rate(r.FGM,r.FGA),'FT%':rate(r.FTM,r.FTA)});
const validBaseline=t=>{const r=raw(t);return validBox(r)&&r.FGA>0&&r.FTA>0&&['FG%','FT%'].every(k=>Number.isFinite(t.stats?.[k])&&Math.abs(t.stats[k]-totals(r)[k])<=0.00051);};
const blocked=reason=>({available:false,reason,modelVersion:MODEL_VERSION,readOnly:true});
export function injuryDecision(report,gameDate){
 if(!report)return {exclude:false,uncertain:false};
 const status=String(report.status).toLowerCase();
 const severe=/^(out|injured reserve|suspended|doubtful)$/.test(status);
 const questionable=/day.to.day|questionable|doubtful|game.time/.test(status);
 const estimate=report.reportedReturnDate;
 return {exclude:severe&&(!day(estimate)||gameDate<estimate),uncertain:severe||questionable};
}
export function availableHistory(rows,asOf){
 const cutoff=stamp(asOf);
 if(!Number.isFinite(cutoff))throw Error('Invalid forecast cutoff');
 return rows.filter(r=>Number.isFinite(stamp(r.observed_at))&&Number.isFinite(stamp(r.tipoff))&&stamp(r.tipoff)<cutoff&&stamp(r.observed_at)<=cutoff&&stamp(r.observed_at)>=stamp(r.tipoff)&&validBox(r.stats));
}
export function forecastMatchup({report,official,logs,asOf,historyThrough,baselineAligned,injuryFeed=null,officialInjuries=null,identityPairs=[],simulations=4000,seed=85892,model='L10'}){
 if(!MODELS.includes(model))return blocked('Unknown model');
 if(!Number.isInteger(simulations)||simulations<100||simulations>20000||!Number.isInteger(seed))return blocked('Invalid simulation parameters');
 const cutoff=stamp(asOf),baseline=stamp(official?.observedAt);
 if(!Number.isFinite(cutoff)||!Number.isFinite(baseline)||baseline>cutoff||cutoff-baseline>300000||!baselineAligned||!report?.complete)return blocked('Aligned fresh Yahoo scoreboard and complete lineups required');
 if(!day(historyThrough)||!report.teams||report.teams.length!==2||Number(report.teams[0].id)!==Number(official.ourTeam?.id)||Number(report.teams[1].id)!==Number(official.opponent?.id)||report.teams[0].id===report.teams[1].id||!validBaseline(official.ourTeam)||!validBaseline(official.opponent))return blocked('Verified team identities and shooting totals required');
 const history=new Map(),seen=new Set();
 for(const r of availableHistory(logs,asOf).sort((a,b)=>stamp(a.tipoff)-stamp(b.tipoff)||String(a.event_id).localeCompare(String(b.event_id)))){
  const key=r.yahoo_id+'|'+r.event_id;
  if(!r.event_id||seen.has(key))return blocked('Duplicate or missing history event ID');
  seen.add(key);if(!history.has(r.yahoo_id))history.set(r.yahoo_id,[]);history.get(r.yahoo_id).push(r.stats);
 }
 const identities=new Map(identityPairs.map(p=>[p.yahoo_id,String(p.espn_id)]));
 const starters=[],missing=[],uncertain=new Set(),used=new Set();
 let minSample=Infinity,excludedStarts=0;
 const feedAt=stamp(injuryFeed?.observedAt);
 const freshInjury=Number.isFinite(feedAt)&&feedAt<=cutoff&&cutoff-feedAt<=86400000;
 const nbaAt=stamp(officialInjuries?.observedAt),nbaPublished=stamp(officialInjuries?.publishedAt);
 const freshOfficial=officialInjuries?.source==='NBA_OFFICIAL'&&Number.isFinite(nbaAt)&&Number.isFinite(nbaPublished)&&nbaPublished<=nbaAt&&nbaAt<=cutoff&&cutoff-nbaPublished<=86400000;
 const officialByGame=new Map(freshOfficial?officialInjuries.rows.map(r=>[String(r.espnId)+'|'+r.gameDate,r]):[]);let officialMatchedStarts=0;
 for(let side=0;side<2;side++){
  for(const p of report.teams[side].players){
   if(p.unknownDates?.length)return blocked('Unknown schedule coverage');
   const games=p.games.filter(g=>g.assignment==='STARTER');
   if(!games.length)continue;
   const samples=history.get(p.yahooId)??[];
   if(samples.length<3){missing.push({name:p.name,starts:games.length});continue;}
   minSample=Math.min(minSample,samples.length);
   for(const game of games){
    const k=p.yahooId+'|'+game.date;
    if(!day(game.date)||used.has(k)||game.date>official.weekEnd||game.date<official.weekStart)return blocked('Invalid or duplicate starter slot');
    used.add(k);
    const r=freshInjury?injuryFeed.rows.get(identities.get(p.yahooId)):null;
    const normalized=s=>String(s??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const verified=r&&normalized(r.name)===normalized(p.name)&&r.nbaTeam===game.nbaTeam&&stamp(r.reportAt)<=cutoff;
    let decision=injuryDecision(verified?r:null,game.date);
    const nba=officialByGame.get(identities.get(p.yahooId)+'|'+game.date);
    // An official game status only applies to that date and club; absence
    // from a report is not medical clearance and NOT YET SUBMITTED is not a status.
    if(nba&&normalized(nba.name)===normalized(p.name)&&teamCode(nba.nbaTeam)===teamCode(game.nbaTeam)&&nba.publishedAt===officialInjuries.publishedAt&&nba.observedAt===officialInjuries.observedAt){
     officialMatchedStarts++;
     decision={exclude:['Out','Doubtful'].includes(nba.status),uncertain:['Out','Doubtful','Questionable'].includes(nba.status)};
    }
    if(decision.uncertain)uncertain.add(p.yahooId);
    if(decision.exclude)excludedStarts++;
    const weights=modelWeights(samples.length,model);let cumulative=0;const cdf=weights.map(w=>cumulative+=w);cdf[cdf.length-1]=1;
    starters.push({side,samples,cdf,exclude:decision.exclude,uncertain:decision.uncertain});
   }
  }
 }
 if(missing.length)return {...blocked('Minimum three observed complete games required for each starter'),missing,coveredStarts:starters.length};
 const rng=random(seed),scenarios=[{id:'ALL_STARTERS_PLAY',exclude:false,stress:false},{id:'REPORTED_OUT_EXCLUSION',exclude:true,stress:false},{id:'UNCERTAIN_PLAYERS_SIT',exclude:true,stress:true}].filter(s=>!s.exclude||(freshInjury||freshOfficial)&&(!s.stress||uncertain.size>0));
 const results=scenarios.map(s=>({id:s.id,exclude:s.exclude,stress:s.stress,counts:Object.fromEntries(NINE_CAT.map(k=>[k,{win:0,tie:0,loss:0}])),match:{win:0,tie:0,loss:0},wins:Array(10).fill(0)}));
 for(let n=0;n<simulations;n++){
  // Common random numbers across scenarios; preserve the complete box-score vector.
  const draws=starters.map(p=>{const rngValue=rng();return p.samples[p.cdf.findIndex(v=>v>rngValue)];});
  for(const s of results){
   const teams=[raw(official.ourTeam),raw(official.opponent)];
   starters.forEach((p,i)=>{if((!s.exclude||!p.exclude)&&(!s.stress||!p.uncertain))for(const k of RAW_KEYS)teams[p.side][k]+=draws[i][k];});
   const c=categoryComparison(totals(teams[0]),totals(teams[1]));
   if(!c.verified)return blocked('Simulation contains undefined category');
   for(const row of c.rows)s.counts[row.category][row.leader==='OURS'?'win':row.leader==='TIE'?'tie':'loss']++;
   s.wins[c.score.ours]++;
   s.match[c.score.ours>c.score.opponent?'win':c.score.ours===c.score.opponent?'tie':'loss']++;
  }
 }
 const proportions=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v/simulations]));
 const inputsDigest=createHash('sha256').update(JSON.stringify({report,official,logs:availableHistory(logs,asOf),injury: freshInjury?[...injuryFeed.rows.entries()]:null,officialInjuries:freshOfficial?officialInjuries:null,identityPairs,asOf,model})).digest('hex');
 return {available:true,inputsDigest,modelVersion:MODEL_VERSION+':'+model,model,asOf,historyThrough,baselineObservedAt:official.observedAt,simulations,seed,conditional:true,calibrated:false,readOnly:true,
  coverage:{starterGames:starters.length,minSample:Number.isFinite(minSample)?minSample:null,injuryFeedVerified:freshInjury,officialInjuryVerified:freshOfficial,officialMatchedStarts,uncertainPlayers:uncertain.size,excludedStarts},
  scenarios:results.map(s=>({id:s.id,matchup:proportions(s.match),categories:NINE_CAT.map(category=>({category,...proportions(s.counts[category])})),categoryWins:s.wins.map(v=>v/simulations),swingTargets:NINE_CAT.filter(k=>official.ourTeam.stats[k]!==undefined&&(k==='TO'?official.ourTeam.stats[k]>=official.opponent.stats[k]:official.ourTeam.stats[k]<=official.opponent.stats[k])).map(category=>({category,win:s.counts[category].win/simulations})).sort((a,b)=>b.win-a.win)})),
  limitations:['Conditional on fixed Yahoo starters and observed game samples; not calibrated real-world probabilities.','Resampling preserves within-game category correlation, not between-player or team correlation.','Official NBA game status overrides ESPN only for a verified player, team and game date. Otherwise ESPN conditional exclusion uses its reported return estimate; neither source proves a future return. No unverified participation probabilities.','The uncertain-players-sit stress scenario excludes all matched uncertain starts; it is not a likely outcome or calibrated confidence interval.','No future trades, lineup changes, minutes regime changes or replacement-player effects modeled.']};
}

export function alternativeForecasts(args){
 const results=MODELS.map(model=>forecastMatchup({...args,model}));
 return {primary:results.find(f=>f.model==='L10')??results[2],alternatives:results,readOnly:true,selection:'L10 incumbent; alternative models are exploratory, not calibrated'};
}
