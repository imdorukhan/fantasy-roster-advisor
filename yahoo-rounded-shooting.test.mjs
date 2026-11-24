import test from 'node:test';
import assert from 'node:assert/strict';
import {assessYahooNineCat} from './yahoo-stat-readiness.mjs';
const base={'FG%':.377,'FT%':.8,'3PM':1,PTS:14,REB:5,AST:4,STL:1,BLK:1,TO:2,FGM:3.3,FGA:8.7,FTM:.3,FTA:.4};
test('real Yahoo rounded average FT volumes are consistent with source season percentages',()=>{
 const verified=[
  {made:.3,attempt:.4,pct:.8},
  {made:2.3,attempt:2.5,pct:.895},
  {made:1.5,attempt:1.8,pct:.867},
  {made:1.3,attempt:1.5,pct:.833},
  {made:1.2,attempt:1.6,pct:.731},
 ];
 for(const c of verified){
  const x=assessYahooNineCat({...base,FTM:c.made,FTA:c.attempt,'FT%':c.pct},{coverage:'average_season'});
  assert.equal(x.ready,true,'One-decimal makes/attempts must allow source percentage within rounding interval: '+JSON.stringify(c));
  assert.deepEqual(x.invalid,[]);
 }
});
test('season totals remain exact and do not inherit per-game rounding tolerance',()=>{
 const x=assessYahooNineCat({...base,FGM:33,FGA:87,FTM:3,FTA:4,'FT%':.8},{coverage:'season'});
 assert.equal(x.ready,false);assert.ok(x.invalid.includes('FT%'));
});
test('grossly wrong shooting rates or impossible attempts still fail closed for season averages',()=>{
 for(const x of [
  {...base,'FT%':.4},
  {...base,FGM:5,FGA:8,'FG%':.9},
  {...base,FTM:1.6,FTA:1.3},
  {...base,'3PM':4}
 ]){
  const result=assessYahooNineCat(x,{coverage:'average_season'});
  assert.equal(result.ready,false);
 }
});
