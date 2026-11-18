import {withScopedTransaction} from './sc3-postgres.mjs';
import {buildStreamingPlan} from './sc3-streaming-plan.mjs';

const leagueId = 85892;
const maxAgeMs = 30 * 60 * 60 * 1000;

function verifiedGroup(row, filter, now) {
  const seen = new Set();
  const payload = row?.payload;
  const age = now - Date.parse(row?.observed_at);
  if (!Number.isFinite(age) || age < 0 || age > maxAgeMs ||
      payload?.leagueId !== leagueId || payload.sourceFilter !== filter ||
      payload.complete !== true || payload.individualOwnershipVerified !== true ||
      !Array.isArray(payload.players) || payload.count !== payload.players.length) {
    throw Error('Verified Yahoo ownership snapshot unavailable');
  }
  const availability = filter === 'FA' ? 'FREE_AGENT' : 'WAIVERS';
  const players = payload.players.map(player => {
    if (!/^\d+$/.test(player?.yahooId) || typeof player.name !== 'string' || !player.name.trim() ||
        player.availability !== availability || seen.has(player.yahooId) ||
        (filter === 'FA' ? player.yahooRosterStatus !== 'FA' : !/^W \([A-Z][a-z]{2} \d{1,2}\)$/.test(player.yahooRosterStatus))) {
      throw Error('Invalid Yahoo ownership snapshot');
    }
    seen.add(player.yahooId);
    const metadata=/^[A-Z]{2,3}$/.test(player.nbaTeam)&&Array.isArray(player.eligiblePositions)&&player.eligiblePositions.length&&
      player.eligiblePositions.every(pos=>/^(PG|SG|SF|PF|C)$/.test(pos))
      ? {nbaTeam:player.nbaTeam,eligiblePositions:player.eligiblePositions} : {};
    return {yahooId: player.yahooId, name: player.name, availability, yahooRosterStatus: player.yahooRosterStatus, ...metadata};
  });
  return {observedAt: row.observed_at, count: players.length, players};
}

export function streamingAvailability(rows, now = Date.now()) {
  const freeAgents = verifiedGroup(rows.find(row => row.section === 'free_agents'), 'FA', now);
  const waivers = verifiedGroup(rows.find(row => row.section === 'waivers'), 'W', now);
  const freeIds = new Set(freeAgents.players.map(player => player.yahooId));
  if (waivers.players.some(player => freeIds.has(player.yahooId))) throw Error('Conflicting Yahoo ownership');
  return {mode: 'SC3_STREAMING_AVAILABILITY', leagueId, readOnly: true, freeAgents, waivers};
}

export async function readStreamingAvailability() {
  const rows = await withScopedTransaction(async client => (await client.query(
    `select section, payload, observed_at::text from sc3.yahoo_league_snapshots
     where league_id = $1 and (
       (section in ('free_agents', 'waivers') and source = 'Yahoo Fantasy Basketball league player list') or
       (section in ('settings', 'roster', 'scoreboard') and source = 'Yahoo Fantasy Sports API')
     )`, [leagueId]
  )).rows);
  const result = streamingAvailability(rows);
  const yahooRows = Object.fromEntries(rows.map(row => [row.section, row]));
  return {...result, plan: await buildStreamingPlan(result, yahooRows)};
}
