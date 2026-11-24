import test from 'node:test';
import assert from 'node:assert/strict';
import {forecastMatchup,availableHistory,injuryDecision,alternativeForecasts} from './sc3-forecast.mjs';
import {forecastsFromEspn,returnForecast,settleReturn,sourceReliability} from './sc3-return-ledger.mjs';
import {appendObservedForecasts,readReturnLedger,appendVerifiedSettlements} from './sc3-return-store.mjs';
import {walkForwardGameTest} from './sc3-walk-forward.mjs';
import {ESPN_INJURY_SOURCE} from './sc3-injury-feed.mjs';
const asOf='2026-11-24T20:00:00Z';
const stats={PTS:11,REB:4,AST:3,STL:1,BLK:1,TO:1,FGM:4,FGA:8,FTM:2,FTA:2,'3PM':1,MIN:25};
const t=(id)=>({id,stats:{...stats,'FG%':.5,'FT%':1},shooting:{FGM:4,FGA:8,FTM:2,FTA:2}});
const official={ourTeam:t(5),opponent:t(2),observedAt:asOf,weekStart:'2026-11-23',weekEnd:'2026-11-29'};
const p=(id,name)=>({yahooId:id,name,unknownDates:[],games:[{assignment:'STARTER',date:'2026-11-25',nbaTeam:'SAC'},{assignment:'BENCH',date:'2026-11-26',nbaTeam:'SAC'}]});
const report={complete:true,teams:[{id:5,players:[p('10','A')]},{id:2,players:[p('20','B')]}]};
const logs=['10','20'].flatMap(yahoo_id=>[19,20,21].map((d,i)=>({yahoo_id,event_id:String(d),espn_id:yahoo_id,tipoff:'2026-11-'+d+'T02:00:00Z',observed_at:'2026-11-'+d+'T10:00:00Z',stats:{...stats,PTS:10+i}})));
const args={report,official,logs,asOf,historyThrough:'2026-11-23',baselineAligned:true,simulations:1000,seed:7};
test('Monte Carlo is deterministic and category win/tie/loss distributions sum to one',()=>{
 const f=forecastMatchup(args);assert.equal(f.available,true);assert.deepEqual(f,forecastMatchup(args));assert.equal(f.coverage.starterGames,2);
 assert.equal(f.calibrated,false);assert.equal(f.conditional,true);
 for(const s of f.scenarios){for(const r of s.categories)assert.ok(Math.abs(r.win+r.tie+r.loss-1)<1e-12);assert.ok(Math.abs(s.categoryWins.reduce((a,b)=>a+b,0)-1)<1e-12);assert.ok(Math.abs(s.matchup.win+s.matchup.tie+s.matchup.loss-1)<1e-12);}
});
test('future observations, duplicate games, bad denominators and incomplete coverage fail closed',()=>{
 const late={...logs[0],observed_at:'2026-11-25T10:00:00Z'};
 assert.equal(availableHistory([late],asOf).length,0);
 assert.equal(forecastMatchup({...args,logs:[late,...logs.slice(1)]}).available,false);
 assert.equal(forecastMatchup({...args,logs:[...logs,logs[0]]}).available,false);
 assert.equal(forecastMatchup({...args,baselineAligned:false}).available,false);
 assert.equal(forecastMatchup({...args,official:{...official,ourTeam:{...t(5),shooting:{FGM:0,FGA:0,FTM:2,FTA:2}}}}).available,false);
});
test('injury exclusion is conditional, never an invented participation probability; turnovers use lower-is-better',()=>{
 const injuryFeed={observedAt:asOf,rows:new Map([['10',{name:'A',nbaTeam:'SAC',status:'Out',reportedReturnDate:'2026-11-27',reportAt:'2026-11-24T18:00:00Z'}]])};
 const f=forecastMatchup({...args,injuryFeed,identityPairs:[{yahoo_id:'10',espn_id:'10'}]});
 assert.equal(f.coverage.excludedStarts,1);assert.equal(f.scenarios.length,3);
 assert.equal(f.scenarios[1].categories.find(c=>c.category==='TO').win,1);
 assert.equal(f.scenarios[1].categories.find(c=>c.category==='PTS').loss,1);
 assert.equal(injuryDecision({status:'Day-To-Day'},'2026-11-25').exclude,false);
 const q=forecastMatchup({...args,injuryFeed:{...injuryFeed,rows:new Map([['10',{...injuryFeed.rows.get('10'),status:'Day-To-Day'}]])},identityPairs:[{yahoo_id:'10',espn_id:'10'}]});
 assert.deepEqual(q.scenarios[0].matchup,q.scenarios[1].matchup);assert.equal(q.scenarios[2].categories.find(c=>c.category==='PTS').loss,1);
});
const source={source:'ESPN',sourceUrl:ESPN_INJURY_SOURCE,espnId:'10',reportAt:'2026-11-24T17:00:00Z',feedObservedAt:'2026-11-24T19:00:00Z',estimatedDate:'2026-11-26',status:'Out'};
const f=returnForecast(source,asOf);
test('forecast provenance requires explicit date, source and chronological capture; dedupe repeats',()=>{
 assert.ok(f.id);assert.equal(returnForecast({...source,estimatedDate:null},asOf),null);
 assert.equal(returnForecast({...source,sourceUrl:'https://example.com'},asOf),null);
 assert.equal(returnForecast({...source,feedObservedAt:'2026-11-25T00:00:00Z'},asOf),null);
 assert.equal(returnForecast({...source,estimatedDate:'2026-11-23'},asOf),null);
 assert.equal(returnForecast({...source,feedObservedAt:asOf},asOf).id,f.id);
 const feed={observedAt:source.feedObservedAt,rows:new Map([['10',{espnId:'10',reportAt:source.reportAt,reportedReturnDate:source.estimatedDate,status:'Out'}]])};
 assert.equal(forecastsFromEspn(feed,asOf).length,1);
});
const cutoff='2026-11-28T12:00:00Z';
const actual={espn_id:'10',event_id:'77',game_day:'2026-11-27',tipoff:'2026-11-27T23:00:00Z',observed_at:'2026-11-28T08:00:00Z',stats:{...stats}};
const days=[24,25,26,27].map(d=>({game_day:'2026-11-'+d,status:'complete',coverage_verified:true,observed_at:cutoff}));
test('settle only first verified appearance with complete intervening days and no prior return',()=>{
 const s=settleReturn(f,[actual],days,cutoff);assert.equal(s.actualDate,'2026-11-27');assert.equal(s.absoluteErrorDays,1);assert.equal(s.hitWithin3,true);
 assert.equal(settleReturn(f,[actual],days.slice(1),cutoff),null);
 assert.equal(settleReturn(f,[{...actual,observed_at:'2026-11-29T00:00:00Z'}],days,cutoff),null);
 assert.equal(settleReturn(f,[actual,{...actual,tipoff:'2026-11-24T18:00:00Z',game_day:'2026-11-24'}],days,cutoff),null);
 assert.equal(settleReturn(f,[{...actual,stats:{...stats,MIN:0}}],days,cutoff),null);
});
test('reliability does not rank tiny samples or use future settlement; one report revision counts once',()=>{
 const s=settleReturn(f,[actual],days,cutoff);
 const revision=returnForecast({...source,estimatedDate:'2026-11-27'},'2026-11-24T21:00:00Z');
 const r=sourceReliability([f,revision],[s],{asOf:new Date(cutoff)})[0];
 assert.equal(r.recorded,1);assert.equal(r.settled,1);assert.equal(r.reliability,null);assert.equal(r.maeDays,1);
 assert.equal(sourceReliability([f],[s],{asOf:new Date(asOf)})[0].settled,0);
});
test('writer cannot use shared transaction by default and absent schema is unavailable, not a zero score',async()=>{
 await assert.rejects(appendObservedForecasts({}),/Dedicated/);await assert.rejects(appendVerifiedSettlements(),/Dedicated/);
 const r=await readReturnLedger({transaction:async()=>{throw Error('missing table')}});assert.equal(r.status,'UNAVAILABLE');assert.equal(r.recorded,null);
 const queries=[];
 const feed={observedAt:source.feedObservedAt,rows:new Map([['10',{espnId:'10',reportAt:source.reportAt,reportedReturnDate:source.estimatedDate,status:'Out'}]])};
 const result=await appendObservedForecasts(feed,{writerTransaction:async fn=>fn({query:async(sql,params)=>{queries.push(sql);return sql.includes('clock_timestamp')?{rows:[{now:asOf}]}:{rowCount:1,rows:[]};}})});
 assert.equal(result.inserted,1);assert.match(queries[1],/on conflict do nothing/);assert.doesNotMatch(queries[1],/do update/i);
});
test('walk-forward never trains on rows not observed before target tipoff, and excludes future outcomes',()=>{
 const rows=[1,2,3,4,5].map(d=>({espn_id:'10',event_id:String(d),tipoff:'2026-11-0'+d+'T02:00:00Z',observed_at:'2026-11-0'+d+'T08:00:00Z',stats:{...stats,PTS:d}}));
 let r=walkForwardGameTest(rows,{asOf});assert.equal(r.scored,2);assert.equal(r.skipped,3);assert.equal(r.calibratesMatchup,false);
 rows[0].observed_at='2026-11-05T10:00:00Z';
 r=walkForwardGameTest(rows,{asOf});assert.equal(r.scored,1);assert.equal(r.skipped,4);
 assert.equal(walkForwardGameTest(rows,{asOf:'2026-11-04T05:00:00Z'}).scored,0);
});

test('multiple daily injury reports settling on one return event contribute only one source score sample',()=>{
 const s=settleReturn(f,[actual],days,cutoff);
 const revised=returnForecast({...source,reportAt:'2026-11-25T17:00:00Z',feedObservedAt:'2026-11-25T19:00:00Z',estimatedDate:'2026-11-27'},'2026-11-25T20:00:00Z');
 const later=settleReturn(revised,[actual],days,cutoff);
 const r=sourceReliability([f,revised],[s,later],{asOf:new Date(cutoff)})[0];
 assert.equal(r.recorded,2);assert.equal(r.settledReports,2);assert.equal(r.settled,1);assert.equal(r.maeDays,1);
});

test('all seven alternatives use the same fixed inputs, history chronology and common seed',()=>{
 const extended=Array.from({length:16},(_,i)=>({yahoo_id:'10',espn_id:'10',event_id:String(i+100),tipoff:'2026-11-'+String(i+1).padStart(2,'0')+'T02:00Z',observed_at:'2026-11-'+String(i+1).padStart(2,'0')+'T10:00Z',stats:{...stats,PTS:i}}));
 const suite=alternativeForecasts({...args,logs:[...extended,...logs],simulations:100});
 assert.equal(suite.alternatives.length,7);assert.equal(suite.primary.model,'L10');
 assert.equal(new Set(suite.alternatives.map(x=>x.inputsDigest)).size,7);
 assert.ok(suite.alternatives.every(x=>x.available&&x.coverage.starterGames===2&&x.conditional&&!x.calibrated));
 assert.notDeepEqual(suite.alternatives.find(x=>x.model==='L3').scenarios,suite.alternatives.find(x=>x.model==='SEASON').scenarios);
 assert.deepEqual(suite,alternativeForecasts({...args,logs:[...extended,...logs],simulations:100}));
});
test('official game status overrides ESPN only for exact player, normalized team and date',()=>{
 const injuryFeed={observedAt:asOf,rows:new Map([['10',{name:'A',nbaTeam:'SAC',status:'Out',reportedReturnDate:'2026-11-27',reportAt:'2026-11-24T18:00Z'}]])};
 const row={espnId:'10',name:'A',nbaTeam:'SAC',gameDate:'2026-11-25',status:'Available',publishedAt:'2026-11-24T19:00Z',observedAt:asOf};
 const nba={source:'NBA_OFFICIAL',publishedAt:row.publishedAt,observedAt:asOf,rows:[row]};
 const input={...args,injuryFeed,identityPairs:[{yahoo_id:'10',espn_id:'10'}]};
 let x=forecastMatchup({...input,officialInjuries:nba});assert.equal(x.coverage.officialMatchedStarts,1);assert.equal(x.coverage.excludedStarts,0);
 for(const change of [{gameDate:'2026-11-26'},{nbaTeam:'LAL'},{name:'Wrong'}]){
  x=forecastMatchup({...input,officialInjuries:{...nba,rows:[{...row,...change}]}});assert.equal(x.coverage.officialMatchedStarts,0);assert.equal(x.coverage.excludedStarts,1);
 }
 x=forecastMatchup({...input,officialInjuries:{...nba,observedAt:'2026-11-25T00:00Z'}});assert.equal(x.coverage.officialInjuryVerified,false);assert.equal(x.coverage.excludedStarts,1);
});
