import test from 'node:test';
import assert from 'node:assert/strict';
import {linkedPerformanceEnvelope} from './sc3-performance-envelope.mjs';
import {rosterStatSource} from './sc3-roster-stat-source.mjs';
import {keepCutEvidence} from './sc3-keepcut-evidence.mjs';
const sample={id:'5214640',season:{complete:true,games:14,values:{PTS:25,REB:7,AST:5,STL:1,BLK:1,TO:2,'FG%':.5,'FT%':.8}},windows:{3:{complete:true,games:3,values:{PTS:26}}}};
test('live owner Yahoo-linked performance carries actual NBA freshness and expected end for roster/Keep-Cut',()=>{
 const out=linkedPerformanceEnvelope({
  report:{source:'ESPN completed games',pool:{players:1},players:[sample]},
  links:new Map([['10452','5214640']]),historyEnd:'2026-11-22',expectedEnd:'2026-11-22',missingDays:[],fresh:true
 },['10452']);
 assert.equal(out.mode,'YAHOO_LINKED_PERFORMANCE');
 assert.equal(out.fresh,true);
 assert.equal(out.expectedEnd,'2026-11-22');
 assert.deepEqual(out.missingDays,[]);
 const perf={...out.players[0].performance,historyEnd:out.historyEnd,expectedEnd:out.expectedEnd,fresh:out.fresh};
 assert.equal(rosterStatSource({yahooId:'10452'},perf).source,'ESPN completed-game season averages');
 assert.equal(keepCutEvidence({status:'A',slot:'PG'},perf).label,'REVIEW ONLY');
});
test('missing or stale coverage cannot impersonate fresh verified season evidence',()=>{
 const data={report:{source:'ESPN',players:[sample]},links:new Map([['10452','5214640']]),historyEnd:'2026-11-21'};
 for(const variant of [{}, {expectedEnd:'2026-11-22',fresh:false,missingDays:['2026-11-22']}]){
  const out=linkedPerformanceEnvelope({...data,...variant},['10452','9999']);
  assert.equal(out.fresh,false);
  assert.equal(out.players[1].performance,null);
  const perf={...out.players[0].performance,historyEnd:out.historyEnd,expectedEnd:out.expectedEnd,fresh:out.fresh};
  assert.equal(rosterStatSource({yahooId:'10452'},perf).source,'Unavailable');
  assert.notEqual(keepCutEvidence({},perf).label,'REVIEW ONLY');
 }
});
