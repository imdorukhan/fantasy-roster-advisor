import {test} from 'node:test';
import assert from 'node:assert/strict';
import {NINE_CAT,freshness,categoryComparison,evaluateMatchup,categorySwing,streamingCalendar,tradeImpact,dataHealth} from './decision-core.mjs';
const now=Date.parse('2026-11-17T21:00:00Z');
const ours={'FG%':0.50,'FT%':0.81,'3PM':30,PTS:200,REB:100,AST:50,STL:20,BLK:11,TO:28};
const opponent={'FG%':0.49,'FT%':0.82,'3PM':32,PTS:190,REB:100,AST:55,STL:21,BLK:9,TO:33};
const snapshot={ourTeam:{id:5,stats:ours},opponent:{id:8,stats:opponent},observedAt:'2026-11-17T20:59:00Z'};
test('full nine-category result honors turnover reversal, ties and counts',()=>{
 const r=categoryComparison(ours,opponent);assert.equal(r.verified,true);assert.equal(r.rows.length,9);assert.equal(r.rows.find(x=>x.category==='TO').leader,'OURS');assert.equal(r.rows.find(x=>x.category==='REB').leader,'TIE');assert.equal(r.score.ours+r.score.opponent+r.score.ties,9);
});
test('missing invalid shooting stats fail closed',()=>{
 assert.equal(categoryComparison({...ours,'FG%':null},opponent).verified,false);
 assert.equal(categoryComparison({...ours,'FG%':1.9},opponent).verified,false);
});
test('freshness rejects undated, stale and future observations',()=>{
 assert.equal(freshness('2026-11-17T20:59:00Z',{now}).valid,true);
 assert.equal(freshness('2026-11-17T19:00:00Z',{now}).valid,false);
 assert.equal(freshness('2026-11-19T20:59:00Z',{now}).valid,false);
 assert.equal(freshness('',{now}).valid,false);
});
test('matchup identity and freshness both mandatory',()=>{
 assert.equal(evaluateMatchup(snapshot,{now}).usable,true);
 assert.equal(evaluateMatchup({...snapshot,opponent:{id:5,stats:opponent}},{now}).usable,false);
 assert.equal(evaluateMatchup({...snapshot,observedAt:'2026-10-22T00:00:00Z'},{now}).usable,false);
});
test('category swing refuses uncalibrated cross-category priorities',()=>{
 const r=categorySwing(categoryComparison(ours,opponent));assert.equal(r.available,true);assert.equal(r.actionable,false);assert.equal(r.targets.every(t=>t.priorityVerified===false),true);
 const calibrated=categorySwing(categoryComparison(ours,opponent),{scaleByCategory:{AST:10,STL:2,'3PM':3,'FT%':0.01}});
 assert.equal(calibrated.targets.some(t=>t.priorityVerified),true);
});
test('streaming calendar requires ownership and remaining adds',()=>{
 assert.equal(streamingCalendar([],{startDate:'2026-11-17',endDate:'2026-11-20'}).available,false);
 const r=streamingCalendar([{playerId:'a',name:'One',position:'PG',ownership:'FREE_AGENT',ownershipVerified:true,scheduledGames:['2026-11-18','2026-11-19']},{playerId:'b',name:'Two',position:'SF',ownership:'FREE_AGENT',ownershipVerified:false,scheduledGames:['2026-11-18','2026-11-20']}],{startDate:'2026-11-17',endDate:'2026-11-20',remainingAdds:1});
 assert.equal(r.available,true);assert.deepEqual(r.shortlist.map(x=>x.playerId),['a']);assert.equal(r.actionable,false);
});
test('trade impact checks attempt-weighted percentages and refuses missing projections',()=>{
 const base={FGM:40,FGA:80,FTM:16,FTA:20,'3PM':20,PTS:100,REB:50,AST:20,STL:10,BLK:5,TO:14};
 const send={FGM:10,FGA:20,FTM:2,FTA:4,'3PM':2,PTS:20,REB:5,AST:3,STL:2,BLK:1,TO:4};
 const receive={FGM:9,FGA:12,FTM:3,FTA:3,'3PM':3,PTS:22,REB:6,AST:4,STL:3,BLK:2,TO:2};
 const r=tradeImpact({send:[send],receive:[receive],rosterTotals:base});assert.equal(r.available,true);assert.equal(r.after['FG%'],39/72);assert.equal(r.changes.PTS,2);assert.equal(r.actionable,false);
 assert.equal(tradeImpact({send:[{}],receive:[receive],rosterTotals:base}).available,false);
});
test('health reports stale and missing feeds instead of masking failures',()=>{
 const r=dataHealth([{name:'Yahoo',observedAt:'2026-11-17T20:59:00Z'},{name:'ESPN',observedAt:'2026-11-17T19:00:00Z'},{name:'NBA',error:'HTTP 403'}],{now});assert.deepEqual(r.checks.map(c=>c.status),['FRESH','STALE','ERROR']);assert.equal(r.healthy,false);
});

test('trade impact refuses impossible starting roster statistics even if the swap makes them look possible',()=>{
 const base={FGM:90,FGA:80,FTM:16,FTA:20,'3PM':20,PTS:100,REB:50,AST:20,STL:10,BLK:5,TO:14};
 const send={FGM:80,FGA:40,FTM:2,FTA:4,'3PM':2,PTS:20,REB:5,AST:3,STL:2,BLK:1,TO:4};
 const receive={FGM:9,FGA:12,FTM:3,FTA:3,'3PM':3,PTS:22,REB:6,AST:4,STL:3,BLK:2,TO:2};
 assert.equal(tradeImpact({send:[send],receive:[receive],rosterTotals:base}).available,false);
});
test('trade impact rejects selling more verified statistics than the roster contains',()=>{
 const base={FGM:10,FGA:30,FTM:9,FTA:15,'3PM':3,PTS:22,REB:4,AST:4,STL:2,BLK:1,TO:2};
 const send={FGM:10,FGA:20,FTM:9,FTA:12,'3PM':4,PTS:24,REB:5,AST:3,STL:2,BLK:1,TO:2};
 const receive={FGM:9,FGA:12,FTM:3,FTA:3,'3PM':3,PTS:22,REB:6,AST:4,STL:3,BLK:2,TO:2};
 assert.equal(tradeImpact({send:[send],receive:[receive],rosterTotals:base}).available,false);
});
