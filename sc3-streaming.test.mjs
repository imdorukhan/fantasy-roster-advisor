import test from 'node:test';
import assert from 'node:assert/strict';
import {streamingAvailability} from './sc3-streaming.mjs';

const observed = '2026-11-18T16:30:00Z';
const now = Date.parse(observed) + 60_000;
const player = {yahooId: '10', name: 'Test Player', availability: 'WAIVERS', yahooRosterStatus: 'W (Nov 19)'};
function group(section, sourceFilter, players, observedAt = observed) {
  return {section, observed_at: observedAt, payload: {
    leagueId: 85892, sourceFilter, complete: true, individualOwnershipVerified: true,
    count: players.length, players
  }};
}
const empty = group('free_agents', 'FA', []);
const waivers = group('waivers', 'W', [player]);

test('verified empty free-agent feed stays separate from waivers', () => {
  const report = streamingAvailability([empty, waivers], now);
  assert.equal(report.freeAgents.count, 0);
  assert.deepEqual(report.freeAgents.players, []);
  assert.deepEqual(report.waivers.players, [player]);
  assert.equal(report.readOnly, true);
});

test('unverified, stale or conflicting ownership fails closed', () => {
  assert.throws(() => streamingAvailability([empty], now));
  assert.throws(() => streamingAvailability([empty, waivers], now + 31 * 3600_000));
  assert.throws(() => streamingAvailability([empty, {...waivers, payload: {...waivers.payload, complete: false}}], now));
  const conflict = group('free_agents', 'FA', [{...player, availability: 'FREE_AGENT', yahooRosterStatus: 'FA'}]);
  assert.throws(() => streamingAvailability([conflict, waivers], now), /Conflicting Yahoo ownership/);
});
