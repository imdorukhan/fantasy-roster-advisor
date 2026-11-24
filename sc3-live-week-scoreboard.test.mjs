import test from 'node:test';
import assert from 'node:assert/strict';
import {safeMatchupFailure} from './sc3-matchup-error.mjs';

test('real Monday Yahoo week 6 partially scored fixture is pending, not a broken source',()=>{
 // Real owner scoreboard after 2026-11-24T00:48:31Z includes some
 // category winners but still omits official FT%; do not fabricate scores.
 const pending=safeMatchupFailure(new Error('Missing official FT%'));
 assert.equal(pending.status,422);
 assert.equal(pending.body.mode,'YAHOO_CURRENT_WEEK_STATS_PENDING');
 assert.match(pending.body.error,/incomplete|not.*published/i);
});
test('malformed and contradictory published category data must not masquerade as pending',()=>{
 for(const message of ['Invalid official FT%','Yahoo category winner mismatch: FG%',
   'Yahoo shooting percentage mismatch: FT%','Yahoo team points mismatch']){
  assert.notEqual(safeMatchupFailure(new Error(message)).body.mode,'YAHOO_CURRENT_WEEK_STATS_PENDING');
 }
});
