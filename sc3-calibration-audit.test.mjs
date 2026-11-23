import test from 'node:test';
import assert from 'node:assert/strict';
import {auditHeldoutCategories} from './sc3-calibration-audit.mjs';
const cats=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
const hour=3600000,day=86400000;
const weekRows=(week)=>{
 const start=Date.UTC(2026,9,5)+((week-1)*7*day),end=start+7*day-1000;
 return cats.map((category,i)=>({
  forecastId:'w'+week+'-'+category,leagueId:85892,teamId:5,opponentId:2,week,category,
  weekStartAt:new Date(start).toISOString(),weekEndAt:new Date(end).toISOString(),
  issuedAt:new Date(start-hour).toISOString(),featuresThroughAt:new Date(start-2*hour).toISOString(),
  outcomeObservedAt:new Date(end+hour).toISOString(),
  predictedWinProbability:.6,outcome:i%2===0?'WIN':'LOSS',
  source:'Yahoo Fantasy Sports API',scoreVerified:true
 }));
};
test('chronologically held-out 9-CAT score audit is descriptive, not a calibrated model',()=>{
 const data=Array.from({length:8},(_,i)=>weekRows(i+1)).flat();
 const result=auditHeldoutCategories(data);
 assert.equal(result.status,'review_only');
 assert.equal(result.heldoutWeeks,8);
 assert.equal(result.evaluatedCategories,72);
 assert.ok(result.brierScore>.2&&result.brierScore<.3);
 assert.equal(result.calibrated,false);
 assert.equal(result.actionable,false);
 assert.equal(result.winProbability,null);
});
test('no predictions or unpublished Yahoo 9-CAT outcomes cannot produce confidence',()=>{
 assert.equal(auditHeldoutCategories([]).calibrated,false);
 assert.equal(auditHeldoutCategories(weekRows(1)).status,'insufficient_heldout');
 assert.equal(auditHeldoutCategories(weekRows(1).map(r=>({...r,scoreVerified:false}))).status,'unverified');
});
test('look-ahead features, after-start forecasts, duplicates and missing categories fail closed',()=>{
 const data=Array.from({length:8},(_,i)=>weekRows(i+1)).flat();
 for(const mutation of [
  rows=>{rows[0].featuresThroughAt=new Date(Date.parse(rows[0].issuedAt)+hour).toISOString()},
  rows=>{rows[0].issuedAt=rows[0].weekEndAt},
  rows=>{rows.push({...rows[0],forecastId:'duplicate'})},
  rows=>{rows.pop()}
 ]){
  const rows=structuredClone(data);mutation(rows);
  const result=auditHeldoutCategories(rows);
  assert.equal(result.calibrated,false);
  assert.notEqual(result.status,'review_only');
  assert.equal(result.brierScore,null);
 }
});
