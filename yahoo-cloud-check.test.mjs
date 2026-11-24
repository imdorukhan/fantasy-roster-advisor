import test from 'node:test';
import assert from 'node:assert/strict';
import {yahooCloudCheck} from './yahoo-cloud-check.mjs';
import handler from './api/auto-data.js';
import {readFileSync} from 'node:fs';

const secret = 'fixture-cron-secret-with-at-least-32-characters';
const instant = Date.parse('2026-11-18T22:00:00Z');
function response() {
  return {
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(value) { this.code = value; return this; },
    json(body) { this.body = body; return this; }
  };
}
function fixture() {
  const requests = [];
  const logs = [];
  const teams = Array.from({length: 14}, (_, i) => ({key: `478.l.85892.t.${i + 1}`}));
  let loads = 0;
  const dependencies = {
    env: {CRON_SECRET: secret, YAHOO_CLOUD_CHECK_UNTIL: '2026-11-19T22:00:00Z'}, now: () => instant,
    log: message => logs.push(message),
    async loadSession() { loads++; return {tokens: {access_token: 'fixture-access-token', expires_at: instant + 3600000}}; },
    findTeams: raw => raw.parsedTeams,
    findPlayers: raw => raw.parsedPlayers,
    async read(token, path) {
      assert.equal(token, 'fixture-access-token');
      requests.push(path);
      if (path.endsWith('/teams?format=json')) return {league: {teams: {count: 14}}, parsedTeams: teams};
      const team = path.match(/\.t\.(\d+)\/roster/);
      if (team) return {roster: {players: {count: 1}}, parsedPlayers: [{yahooId: team[1], name: 'Fixture player'}]};
      if (path.includes('status=FA;')) return {league: {players: {count: 0}}, parsedPlayers: []};
      if (path.includes('status=W;')) return {league: {players: {count: 1}}, parsedPlayers: [{yahooId: '100', name: 'Fixture waiver'}]};
      throw Error('Unexpected Yahoo path');
    }
  };
  dependencies.createClient = owner => ({
    ready: async () => {},
    read: path => dependencies.read(owner.tokens.access_token, path)
  });
  return {dependencies, requests, teams, logs, loads: () => loads};
}
const request = () => ({method: 'GET', headers: {authorization: `Bearer ${secret}`}});

test('the normal API entry rejects an unauthenticated cloud check before loading a session', async () => {
  const res = response();
  await handler({method: 'GET', query: {yahooCloudCheck: '1'}, headers: {}}, res);
  assert.equal(res.code, 401);
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
});

test('invalid authorization including Unicode and query-string credentials never loads a session', async () => {
  for (const req of [
    {method: 'POST', headers: {authorization: `Bearer ${secret}`}},
    {method: 'GET', headers: {}},
    {method: 'GET', headers: {authorization: `Bearer ${'é'.repeat(secret.length)}`}},
    {method: 'GET', headers: {}, query: {token: secret}}
  ]) {
    const fixtureData = fixture(), res = response();
    await yahooCloudCheck(req, res, fixtureData.dependencies);
    assert.ok([401, 405].includes(res.code));
    assert.equal(fixtureData.loads(), 0);
    assert.equal(fixtureData.requests.length, 0);
    assert.equal(fixtureData.logs.length, 0);
  }
});

test('valid session checks 14 unique rosters and both filter samples without returning credentials or players', async () => {
  const fixtureData = fixture(), res = response();
  await yahooCloudCheck(request(), res, fixtureData.dependencies);
  assert.equal(res.code, 200);
  assert.equal(res.body.status, 'PASS');
  assert.equal(res.body.teamCount, 14);
  assert.equal(res.body.playerCount, 14);
  assert.equal(res.body.sampleOverlap, 0);
  assert.equal(fixtureData.requests.length, 17);
  assert.deepEqual(res.body.checks.slice(-2).map(x => [x.section, x.coverage, x.playerCount]), [['FA', 'first_page_only', 0], ['W', 'first_page_only', 1]]);
  assert.equal(res.body.snapshotWrites, 0);
  assert.equal(res.body.oauthRefreshAttempted, false);
  assert.doesNotMatch(JSON.stringify(res.body), /fixture-access-token|Fixture player|Fixture waiver/);
  assert.equal(fixtureData.logs.length, 1);
  assert.deepEqual(JSON.parse(fixtureData.logs[0].slice('YAHOO_CLOUD_ACCESS_CHECK '.length)), res.body);
  assert.doesNotMatch(fixtureData.logs[0], /fixture-access-token|Fixture player|Fixture waiver/);
});

test('missing or uncertain authorization stops before Yahoo roster reads', async () => {
  for (const uncertain of [false, true]) {
    const fixtureData = fixture(), res = response();
    if(uncertain)fixtureData.dependencies.createClient = () => ({ready:async()=>{throw Object.assign(Error('private fixture detail'),{code:'refresh_outcome_uncertain'})}});
    else fixtureData.dependencies.loadSession = async () => null;
    await yahooCloudCheck(request(), res, fixtureData.dependencies);
    assert.equal(res.code, uncertain ? 502 : 503);
    assert.equal(fixtureData.requests.length, 0);
    assert.equal(res.body.oauthRefreshAttempted, false);
    assert.doesNotMatch(JSON.stringify(res.body),/private fixture detail/);
  }
});

test('duplicate or wrong-league teams are rejected before roster collection', async () => {
  for (const key of ['478.l.85892.t.1', '478.l.99999.t.14']) {
    const fixtureData = fixture(), res = response();
    fixtureData.teams[13].key = key;
    await yahooCloudCheck(request(), res, fixtureData.dependencies);
    assert.equal(res.code, 422);
    assert.equal(fixtureData.requests.length, 1);
  }
});

test('duplicate roster IDs, ownership overlap, and declared-count mismatch fail validation', async () => {
  for (const mode of ['duplicate', 'overlap', 'count']) {
    const fixtureData = fixture(), res = response(), read = fixtureData.dependencies.read;
    fixtureData.dependencies.read = async (token, path) => {
      const raw = await read(token, path);
      if (mode === 'duplicate' && path.includes('.t.2/roster')) raw.parsedPlayers[0].yahooId = '1';
      if (mode === 'overlap' && path.includes('status=W;')) raw.parsedPlayers[0].yahooId = '1';
      if (mode === 'count' && path.includes('.t.1/roster')) raw.roster.players.count = 2;
      return raw;
    };
    await yahooCloudCheck(request(), res, fixtureData.dependencies);
    assert.equal(res.code, 422);
    assert.equal(res.body.status, 'FAILED');
  }
});

test('all pending roster requests settle before returning a sanitized failure', async () => {
  const fixtureData = fixture(), res = response(), read = fixtureData.dependencies.read;
  let finished = 0;
  fixtureData.dependencies.read = async (token, path) => {
    if (!path.includes('/roster')) return read(token, path);
    if (path.includes('.t.1/')) throw Object.assign(Error('fixture-access-token upstream echo'), {status: 401});
    await new Promise(resolve => setTimeout(resolve, 5));
    finished++;
    return read(token, path);
  };
  await yahooCloudCheck(request(), res, fixtureData.dependencies);
  assert.equal(res.code, 502);
  assert.equal(finished, 3);
  assert.equal(res.body.checks.at(-1).http, 401);
  assert.doesNotMatch(JSON.stringify(res.body), /fixture-access-token|upstream echo/);
});

test('session-store exceptions are classified without echoing their contents', async () => {
  const fixtureData = fixture(), res = response();
  fixtureData.dependencies.loadSession = async () => { throw Error('private connection details'); };
  await yahooCloudCheck(request(), res, fixtureData.dependencies);
  assert.equal(res.code, 503);
  assert.equal(res.body.category, 'session_store_unavailable');
  assert.doesNotMatch(JSON.stringify(res.body), /private connection/);
  assert.doesNotMatch(fixtureData.logs.join('\n'), /private connection/);
});

test('an unconfigured, expired or invalid test window stops before session access', async () => {
  const cases = [
    [undefined, 200, 'SKIPPED', 'test_window_not_configured'],
    ['2026-11-18T22:00:00Z', 200, 'SKIPPED', 'test_window_expired'],
    ['2026-11-18T21:59:59.999Z', 200, 'SKIPPED', 'test_window_expired'],
    ['invalid-secret-like-input', 503, 'FAILED', 'invalid_test_window'],
    ['2026-02-30T22:00:00Z', 503, 'FAILED', 'invalid_test_window'],
    ['2026-11-19T22:00:00+00:00', 503, 'FAILED', 'invalid_test_window']
  ];
  for (const [cutoff, code, status, category] of cases) {
    const fixtureData = fixture(), res = response();
    fixtureData.dependencies.env.YAHOO_CLOUD_CHECK_UNTIL = cutoff;
    await yahooCloudCheck(request(), res, fixtureData.dependencies);
    assert.equal(res.code, code);
    assert.equal(res.body.status, status);
    assert.equal(res.body.category, category);
    assert.equal(fixtureData.loads(), 0);
    assert.equal(fixtureData.requests.length, 0);
    assert.equal(fixtureData.logs.length, 1);
    assert.doesNotMatch(fixtureData.logs[0], /invalid-secret-like-input/);
  }
});

test('a window remains open immediately before its UTC cutoff', async () => {
  const fixtureData = fixture(), res = response();
  fixtureData.dependencies.env.YAHOO_CLOUD_CHECK_UNTIL = '2026-11-18T22:00:00.001Z';
  await yahooCloudCheck(request(), res, fixtureData.dependencies);
  assert.equal(res.code, 200);
  assert.equal(res.body.status, 'PASS');
  assert.equal(fixtureData.loads(), 1);
});

test('a classified upstream failure has one safe, correlated summary log', async () => {
  const fixtureData = fixture(), res = response();
  fixtureData.dependencies.read = async () => { throw Object.assign(Error('Authorization: Bearer private-upstream-echo'), {status: 403}); };
  await yahooCloudCheck(request(), res, fixtureData.dependencies);
  assert.equal(res.code, 502);
  assert.equal(fixtureData.logs.length, 1);
  const logged = JSON.parse(fixtureData.logs[0].slice('YAHOO_CLOUD_ACCESS_CHECK '.length));
  assert.deepEqual(logged, res.body);
  assert.equal(logged.checks[0].http, 403);
  assert.doesNotMatch(fixtureData.logs[0], /Authorization|Bearer|private-upstream-echo/);
});

test('the full SC3 Yahoo sync replaces the temporary diagnostic and legacy cron', () => {
  const config = JSON.parse(readFileSync(new URL('./vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.crons, [
    {path: '/api/auto-data?sc3YahooSync=1', schedule: '30 16 * * *'},
    {path: '/api/auto-data?sc3DepthSync=1', schedule: '0 19 * * *'},
    {path: '/api/auto-data?sc3NbaHistorySync=1', schedule: '0 11 * * *'},
    {path: '/api/auto-data?sc3ScoreboardSync=1', schedule: '0 12 * * *'}
  ]);
});
