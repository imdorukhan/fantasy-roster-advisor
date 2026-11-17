import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formatCurrentMatchup} from './yahoo-matchup.js';
const keys=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
const ours={id:5,name:'Salary CAPtain',stats:Object.fromEntries(keys.map((k,i)=>[k,i<2?0.5:20+i]))};
const opp={id:8,name:'New opponent',stats:Object.fromEntries(keys.map((k,i)=>[k,i<2?0.4:10+i]))};
const snapshot={status:'observed',fetchedAt:'2026-11-17T21:00:00Z',matchup:{ours,opponent:opp},sources:[{source:'Yahoo matchup',status:'retrieved',url:'https://basketball.fantasysports.yahoo.com/nba/85892/matchup?mid1=5'}]};
test('current Yahoo adapter does not hardcode week or opponent',()=>{
 const r=formatCurrentMatchup(snapshot);assert.equal(r.opponent.id,8);assert.equal(r.week,null);assert.equal(r.weekVerified,false);assert.equal(r.categories.length,9);assert.equal(r.executable,false);
});
test('missing identity, categories and source fail closed',()=>{
 assert.throws(()=>formatCurrentMatchup({...snapshot,status:'unavailable'}));
 assert.throws(()=>formatCurrentMatchup({...snapshot,matchup:{ours,opponent:{...opp,id:5}}}));
 assert.throws(()=>formatCurrentMatchup({...snapshot,sources:[]}));
 assert.throws(()=>formatCurrentMatchup({...snapshot,matchup:{ours:{...ours,stats:{...ours.stats,PTS:null}},opponent:opp}}));
});
