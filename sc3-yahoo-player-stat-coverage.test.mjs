import test from 'node:test';
import assert from 'node:assert/strict';
import {unavailableYahooStatCoverage} from './sc3-yahoo-player-stat-coverage.mjs';
test('a 200 bridge response with no live Yahoo stat rows is explicitly incomplete',()=>{
 const x=unavailableYahooStatCoverage(['10452','10094']);
 assert.equal(x.mode,'YAHOO_PLAYER_STATS');
 assert.equal(x.status,'unavailable');
 assert.equal(x.coverage.requested,2);
 assert.equal(x.coverage.returned,0);
 assert.deepEqual(x.coverage.missingIds,['10452','10094']);
 assert.equal(x.coverage.complete,false);
 assert.equal(x.players.length,2);
 assert.ok(x.players.every(p=>p.stats===null&&p.mpg===null));
 assert.notEqual(x.source,'Yahoo Fantasy Sports API');
});
test('duplicate request IDs cannot inflate the documented coverage denominator',()=>{
 const x=unavailableYahooStatCoverage(['10452','10452']);
 assert.equal(x.coverage.requested,1);
 assert.deepEqual(x.coverage.missingIds,['10452']);
});
