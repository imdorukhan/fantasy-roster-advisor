import test from 'node:test';
import assert from 'node:assert/strict';
import {safeMatchupFailure} from './sc3-matchup-error.mjs';
test('missing current Yahoo week becomes 422, not generic 503',()=>{
 const x=safeMatchupFailure(Error('Exactly one official current Yahoo matchup required'));
 assert.equal(x.status,422);
 assert.equal(x.body.mode,'YAHOO_CURRENT_WEEK_UNVERIFIED');
 assert.equal(x.body.readOnly,true);
});
test('stale or unparsable week never invents lineups',()=>{
 for(const message of ['Yahoo scoreboard snapshot stale or undated','Yahoo scoreboard format unavailable','Opponent or week not verified']){
  const x=safeMatchupFailure(Error(message));assert.equal(x.status,422);
 }
});
test('unexpected database and network failures remain generic without leaking details',()=>{
 const x=safeMatchupFailure(Error('password=do-not-display'));
 assert.equal(x.status,503);
 assert.doesNotMatch(JSON.stringify(x),/do-not-display/);
});

test('current matchup is identified but unscored, so lineup endpoint returns safe 422',()=>{
 const x=safeMatchupFailure(Error('Yahoo current-week category totals not published'));
 assert.equal(x.status,422);
 assert.equal(x.body.mode,'YAHOO_CURRENT_WEEK_STATS_PENDING');
 assert.equal(x.body.readOnly,true);
 assert.equal('score' in x.body,false);
});
