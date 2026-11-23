import test from 'node:test';
import assert from 'node:assert/strict';
import {keepCutEvidence} from './sc3-keepcut-evidence.mjs';
const sample={windows:{3:{complete:true,games:3,values:{PTS:22.6}}},fresh:true,historyEnd:'2026-11-22',expectedEnd:'2026-11-22'};
test('fresh three-game sample permits a read-only review, never a drop recommendation',()=>{
 const x=keepCutEvidence({status:'A',slot:'PG'},sample);
 assert.equal(x.label,'REVIEW ONLY');
 assert.equal(x.recentPoints,22.6);
 assert.equal(x.dropRecommendation,null);
});
test('historical results cannot be labeled current when NBA daily sync is stale',()=>{
 for(const v of [{...sample,fresh:false},{...sample,expectedEnd:'2026-11-23'},{...sample,historyEnd:'2026-11-20'}]){
  const x=keepCutEvidence({status:'O',slot:'IL'},v);
  assert.equal(x.label,'HISTORY STALE');
  assert.equal(x.recentPoints,null);
  assert.equal(x.injured,true);
  assert.equal(x.injuryFlag,'O');
 }
});
test('missing recent history and a current Yahoo injury flag remain unscored',()=>{
 const x=keepCutEvidence({status:'Q',slot:'BN'},null);
 assert.equal(x.label,'SAMPLE 0/3');
 assert.equal(x.injuryFlag,'Q');
 assert.equal(x.dropRecommendation,null);
});
