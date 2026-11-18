import crypto from 'node:crypto';

const leagueKey = '478.l.85892';
const expectedKeys = Array.from({length: 14}, (_, i) => `${leagueKey}.t.${i + 1}`);

function authorized(req, secret) {
  const header = req.headers?.authorization;
  if (typeof secret !== 'string' || secret.length < 32 || typeof header !== 'string') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);
  return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

function collectionCount(node, name) {
  if (!node || typeof node !== 'object') return null;
  if (Object.hasOwn(node, name)) {
    const count = node[name]?.count;
    return /^(0|[1-9]\d*)$/.test(String(count)) ? Number(count) : null;
  }
  for (const value of Object.values(node)) {
    const count = collectionCount(value, name);
    if (count !== null) return count;
  }
  return null;
}

function validPlayers(players, count, seen) {
  if (count === null || count !== players.length) return false;
  for (const player of players) {
    const id = String(player.yahooId ?? '');
    if (!/^[1-9]\d*$/.test(id) || !player.name?.trim() || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

// Dependencies use the application's existing session loader and Yahoo parsers.
// This check never refreshes OAuth, saves snapshots, or returns player/token data.
export async function yahooCloudCheck(req, res, {loadSession, read, findTeams, findPlayers, env = process.env, now = Date.now, log = console.info} = {}) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({error: 'Method not allowed'});
  }
  if (!authorized(req, env.CRON_SECRET)) return res.status(401).json({error: 'Unauthorized'});

  const result = {
    mode: 'YAHOO_CLOUD_ACCESS_CHECK', leagueId: 85892,
    startedAt: new Date(now()).toISOString(), readOnly: true,
    snapshotWrites: 0, oauthRefreshAttempted: false, checks: []
  };
  const finish = (status, category, outcome) => {
    const summary = {
      ...result, status: outcome ?? (status === 200 ? 'PASS' : status >= 500 || status === 422 ? 'FAILED' : 'UNVERIFIED'),
      category, completedAt: new Date(now()).toISOString()
    };
    log('YAHOO_CLOUD_ACCESS_CHECK ' + JSON.stringify(summary));
    return res.status(status).json(summary);
  };
  // Activate only for an explicitly bounded UTC test window at deployment time.
  // The cron registration remains until removed from vercel.json and redeployed.
  const cutoff = env.YAHOO_CLOUD_CHECK_UNTIL;
  if (!cutoff) return finish(200, 'test_window_not_configured', 'SKIPPED');
  const until = Date.parse(cutoff);
  const canonical = cutoff.includes('.') ? cutoff : cutoff.replace('Z', '.000Z');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(cutoff) || !Number.isFinite(until) || new Date(until).toISOString() !== canonical) return finish(503, 'invalid_test_window');
  if (now() >= until) return finish(200, 'test_window_expired', 'SKIPPED');
  result.testWindowUntil = new Date(until).toISOString();
  let session;
  try {
    session = (await loadSession())?.tokens;
  } catch {
    return finish(503, 'session_store_unavailable');
  }
  if (typeof session?.access_token !== 'string' || !session.access_token) return finish(503, 'owner_authorization_unavailable');
  if (!Number.isFinite(session.expires_at) || session.expires_at < now() + 60000) return finish(409, 'access_token_refresh_required');

  let stage = 'teams';
  try {
    const raw = await read(session.access_token, `league/${leagueKey}/teams?format=json`);
    const teams = findTeams(raw);
    if (collectionCount(raw, 'teams') !== 14 || teams.length !== 14 ||
        new Set(teams.map(team => team.key)).size !== 14 ||
        teams.some(team => !expectedKeys.includes(team.key))) return finish(422, 'invalid_team_coverage');
    result.checks.push({section: 'teams', http: 200, teamCount: 14});

    const seen = new Set();
    // Bound concurrency and retain a deterministic team order in the summary.
    for (let start = 0; start < teams.length; start += 4) {
      stage = 'rosters';
      const batch = teams.slice(start, start + 4);
      const responses = await Promise.allSettled(batch.map(team => read(session.access_token, `team/${team.key}/roster?format=json`)));
      for (const [index, response] of responses.entries()) {
        const teamKey = batch[index].key;
        if (response.status === 'rejected') {
          const http = response.reason?.status;
          result.checks.push({section: 'roster', teamKey, http: Number.isInteger(http) && http >= 400 && http <= 599 ? http : null, ok: false});
          return finish(502, 'roster_request_failed');
        }
        const players = findPlayers(response.value);
        if (!players.length || !validPlayers(players, collectionCount(response.value, 'players'), seen)) return finish(422, 'invalid_roster_coverage');
        result.checks.push({section: 'roster', teamKey, http: 200, playerCount: players.length});
      }
    }
    result.teamCount = 14;
    result.playerCount = seen.size;

    for (const filter of ['FA', 'W']) {
      stage = filter;
      const data = await read(session.access_token, `league/${leagueKey}/players;status=${filter};start=0;count=25?format=json`);
      const players = findPlayers(data);
      if (players.length > 25 || !validPlayers(players, collectionCount(data, 'players'), seen)) return finish(422, 'invalid_ownership_sample');
      result.checks.push({section: filter, http: 200, playerCount: players.length, coverage: 'first_page_only', offset: 0});
    }
    result.sampleOverlap = 0;
    return finish(200, 'access_verified');
  } catch (error) {
    const status = error?.status;
    result.checks.push({section: stage, http: Number.isInteger(status) && status >= 400 && status <= 599 ? status : null, ok: false});
    return finish(502, 'yahoo_request_failed');
  }
}
