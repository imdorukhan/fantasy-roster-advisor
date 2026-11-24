import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectYahooStatShape} from './yahoo-stat-shape.mjs';
import {loadPlayerStats} from './yahoo-player-stats.mjs';
test('owner-only Yahoo diagnostics reveal structural coverage mismatch without leaking raw contents',async()=>{
 const data={players:{0:{player:[[{player_id:'42'},{name:{full:'TEST PRIVATE PLAYER'}}],{player_stats:{coverage_type:'season',stats:[{stat:{stat_id:'12',value:'7'}}]}}]},count:1},access_token:'SECRET_STUB'};
 const shape=inspectYahooStatShape(data,['42']);
 assert.equal(shape.playerContainers,1);
 assert.equal(shape.matchingPlayerIds,1);
 assert.equal(shape.statBlocks,1);
 assert.equal(shape.coverageTypes.season,1);
 assert.equal(shape.statRows,1);
 assert.equal(shape.coverageFingerprints['string:6:'+ (await import('node:crypto')).createHash('sha256').update('season').digest('hex').slice(0,12)],1);
 assert.ok(!JSON.stringify(shape).includes('TEST PRIVATE PLAYER'));
 assert.ok(!JSON.stringify(shape).includes('SECRET_STUB'));
 const r=await loadPlayerStats({gameKey:'478',playerIds:['42'],coverage:'average_season',diagnostics:true,
  read:async path=>path.includes('stat_categories')?{stat_categories:{stats:[]}}:data});
 assert.equal(r.returned,0);
 assert.equal(r.diagnostics.batches[0].matchingPlayerIds,1);
 assert.equal(r.diagnostics.batches[0].coverageTypes.season,1);
 assert.equal(r.diagnostics.batches[0].requestedCoverage,'average_season');
});
test('diagnostics are not produced for ordinary player-stat reads',async()=>{
 const r=await loadPlayerStats({gameKey:'478',playerIds:['42'],coverage:'season',
  read:async path=>path.includes('stat_categories')?{stat_categories:{stats:[]}}:{players:{}}});
 assert.equal('diagnostics' in r,false);
});
