import test from 'node:test';
import assert from 'node:assert/strict';
import {matchupWithPlayer,projectedProduction,scheduledSeasonGames,netProduction,rosterChangeDate} from './sc3-player-evaluation.mjs';

const average={'3PM':2,PTS:12,REB:3,AST:2,STL:1,BLK:0,TO:1,FGM:4,FGA:8,FTM:2,FTA:2};
const own={'3PM':3,PTS:20,REB:9,AST:7,STL:4,BLK:2,TO:2,'FG%':0.45,'FT%':0.8};
const opponent={...own,PTS:30,TO:2};
const baseline={rows:Object.keys(own).map(category=>({category,ours:own[category],opponent:opponent[category]})),shooting:{FGM:9,FGA:20,FTM:4,FTA:5},score:{ours:0,opponent:1,ties:8}};
test('add scenario recomputes head-to-head percentage categories with attempts',()=>{
 const add=projectedProduction(average,2);
 assert.equal(add.PTS,24);
 const result=matchupWithPlayer(baseline,add);
 assert.equal(result.changes.find(row=>row.category==='FG%').withPlayer,17/36);
 assert.equal(result.changes.find(row=>row.category==='TO').leader,'OPPONENT');
 assert.equal(result.changes.length,9);
 const points=result.changes.find(row=>row.category==='PTS');
 assert.deepEqual([points.baseline,points.withPlayer,points.opponent,points.delta,points.previousLeader,points.leader],[20,44,30,24,'OPPONENT','OURS']);
 const turnovers=result.changes.find(row=>row.category==='TO');
 assert.deepEqual([turnovers.delta,turnovers.previousLeader,turnovers.leader],[2,'TIE','OPPONENT']);
 assert.equal(matchupWithPlayer(null,add),null);
});
test('season schedule uses published games through the Yahoo league deadline',()=>{
 const events=Array.from({length:80},(_,i)=>({id:String(i+1),date:i===0?'2027-03-29T03:00Z':'2027-03-30T03:00Z',
  seasonType:{type:2},competitions:[{status:{type:{name:'STATUS_SCHEDULED'}},competitors:[{team:{abbreviation:'GS'}},{team:{abbreviation:'LAL'}}]}]}));
 const data={team:{abbreviation:'GS'},season:{year:2027,type:2},events};
 assert.deepEqual(scheduledSeasonGames(data,'GSW',2027,new Date('2026-11-18'),'2027-03-28'),['2027-03-28']);
 assert.throws(()=>scheduledSeasonGames({...data,events:events.slice(0,10)},'GSW',2027,new Date('2026-11-18'),'2027-03-28'),/coverage/);
});

test('net add/drop subtracts outgoing counting stats and shooting attempts',()=>{
 const incoming=projectedProduction(average,2), outgoing=projectedProduction({...average,PTS:14,FGA:10},1);
 const net=netProduction(incoming,outgoing);
 assert.equal(net.PTS,10);
 assert.equal(net.FGA,6);
 assert.equal(matchupWithPlayer(baseline,net).changes.find(row=>row.category==='FG%').withPlayer,13/26);
 assert.equal(rosterChangeDate('2026-11-18','W (Nov 19)'),'2026-11-20');
 assert.equal(rosterChangeDate('2026-11-18','W (Nov 15)'),null);
});

test('player projections reject impossible shooting percentages, rather than displaying over 100%',()=>{
 assert.equal(projectedProduction({...average,FGM:12,FGA:8},2),null);
 assert.equal(projectedProduction({...average,FTM:3,FTA:2},2),null);
 assert.equal(projectedProduction({...average,'3PM':5,FGM:4},2),null);
});
test('net projections reject incomplete shooting input instead of producing NaN deltas',()=>{
 const good=projectedProduction(average,2);
 assert.equal(netProduction(good,{...good,FTA:undefined}),null);
 assert.equal(netProduction(good,{...good,FGA:-1}),null);
});
