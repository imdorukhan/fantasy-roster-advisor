import {streamingCalendar} from './decision-core.mjs';
import {leagueToday, officialMatchupFromScoreboard} from './yahoo-scoreboard.mjs';
import {collect} from './scripts/collect-yahoo-ownership.mjs';

const rosterUrl = 'https://basketball.fantasysports.yahoo.com/nba/85892/5';
const espnUrl = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=';
const aliases = {GS:'GSW', NO:'NOP', NY:'NYK', SA:'SAS', UTAH:'UTA', WSH:'WAS', BRK:'BKN'};
const nbaTeam = value => aliases[value] || value;
const maxAge = 30 * 3600_000;

function fresh(row, now) {
  const observed = Date.parse(row?.observed_at);
  return Number.isFinite(observed) && observed <= now.getTime() && now.getTime() - observed <= maxAge;
}

function yahooWindow(rows, now) {
  const {settings, roster, scoreboard} = rows;
  if (![settings, roster, scoreboard].every(row => fresh(row, now))) throw Error('Yahoo matchup, settings or roster snapshot is missing or stale');
  const matchup = officialMatchupFromScoreboard(scoreboard.payload, {observedAt: scoreboard.observed_at, now});
  const config = settings.payload?.league?.[1]?.settings?.[0];
  const teamMeta = roster.payload?.team?.[0];
  if (!Array.isArray(teamMeta) || !teamMeta.some(part => part?.team_key === '478.l.85892.t.5')) throw Error('Yahoo roster team could not be verified');
  const adds = teamMeta.find(part => part?.roster_adds)?.roster_adds;
  const limit = config?.max_weekly_adds;
  const used = adds?.value;
  if (!/^\d+$/.test(String(limit)) || !/^\d+$/.test(String(used)) ||
      adds.coverage_type !== 'week' || Number(adds.coverage_value) !== matchup.week || Number(used) > Number(limit)) {
    throw Error('Yahoo weekly acquisitions could not be verified');
  }
  const starters = config.roster_positions?.map(entry => entry.roster_position).filter(slot => Number(slot?.is_starting_position) === 1);
  if (!starters?.length || new Set(starters.map(slot => slot.position)).size !== starters.length ||
      starters.some(slot => !/^(PG|SG|G|SF|PF|F|C|FC|Util)$/.test(slot.position) || !Number.isInteger(slot.count) || slot.count < 1)) {
    throw Error('Yahoo starting slots could not be verified');
  }
  return {
    week: matchup.week, start: leagueToday(now), end: matchup.weekEnd, starters,
    acquisitions: {limit:Number(limit), used:Number(used), remaining:Number(limit) - Number(used), observedAt:roster.observed_at}
  };
}

export function openYahooSlots(html, day, starters) {
  const options = [...html.matchAll(/<option\b[^>]*\bvalue=['"]([^'"]+)['"][^>]*\bselected(?:\s*=\s*['"][^'"]*['"])?\s*>/gi)];
  const dateVerified = options.some(([, href]) => {
    const url = new URL(href.replaceAll('&amp;', '&'), rosterUrl);
    return url.origin === new URL(rosterUrl).origin && url.pathname === '/nba/85892/5/team' && url.searchParams.get('date') === day;
  });
  if (!dateVerified) throw Error('Yahoo lineup date could not be verified');
  const table = html.match(/<table\b[^>]*\bid=["']statTable0["'][^>]*>[\s\S]*?<\/table>/i)?.[0];
  const body = table?.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) throw Error('Yahoo lineup table missing');
  const rows = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => ({
    slot: row.match(/\bdata-pos=["']([^"']+)["']/i)?.[1],
    occupied: /\bdata-ys-playerid=["']\d+["']/i.test(row),
    empty: />\s*(?:\(Empty\)|Empty)\s*</i.test(row)
  }));
  const open = [];
  for (const {position, count} of starters) {
    const matches = rows.filter(row => row.slot === position);
    if (matches.length !== count || matches.some(row => !row.occupied && !row.empty)) throw Error('Yahoo lineup slot coverage could not be verified');
    for (const row of matches) if (!row.occupied) open.push(position);
  }
  return open;
}

export function upcomingTeams(json, date, now) {
  if (json?.leagues?.[0]?.slug !== 'nba' || !Array.isArray(json.events)) throw Error('ESPN NBA scoreboard could not be verified');
  const teams = new Set();
  for (const game of json.events) {
    const start = Date.parse(game.date);
    const competitors = game.competitions?.[0]?.competitors?.map(entry => nbaTeam(entry.team?.abbreviation));
    if (!Number.isFinite(start) || leagueToday(new Date(start)) !== date ||
        competitors?.length !== 2 || new Set(competitors).size !== 2 || competitors.some(team => !/^[A-Z]{2,3}$/.test(team)) ||
        !['pre','in','post'].includes(game.status?.type?.state)) throw Error('ESPN game coverage could not be verified');
    if (start > now.getTime() && game.status.type.state === 'pre' && game.status.type.name === 'STATUS_SCHEDULED') {
      for (const team of competitors) teams.add(team);
    }
  }
  return {teams, gameCount:json.events.length};
}

export function rankStreamingFits(players, dates, acquisitions) {
  const candidates = players.map(player => {
    const positions = new Set(player.eligiblePositions);
    const canPlay = slot => positions.has(slot) || ({G:['PG','SG'], F:['SF','PF'], FC:['SF','PF','C'], Util:['PG','SG','SF','PF','C']}[slot] || []).some(pos => positions.has(pos));
    const scheduledGames = dates.filter(date => date.teams.has(nbaTeam(player.nbaTeam)) && date.openSlots.some(canPlay)).map(date => date.date);
    return {playerId:player.yahooId, name:player.name, ownership:'FREE_AGENT', ownershipVerified:true, scheduledGames};
  }).filter(player => player.scheduledGames.length);
  return streamingCalendar(candidates,{startDate:dates[0].date,endDate:dates.at(-1).date,remainingAdds:acquisitions.remaining});
}

export async function buildStreamingPlan(availability, yahooRows, {now=new Date(), fetcher=fetch}={}) {
  let window;
  try {window = yahooWindow(yahooRows, now);}
  catch (error) {return {available:false, reason:error.message};}
  const {start,end,week,starters,acquisitions} = window;
  const dates = [];
  for (let date = new Date(start+'T12:00:00Z'); date.toISOString().slice(0,10)<=end && dates.length<8; date.setUTCDate(date.getUTCDate()+1)) {
    dates.push(date.toISOString().slice(0,10));
  }
  const metadata = [];
  try {
    if (!dates.length || dates.at(-1)!==end) throw Error('Yahoo matchup date range could not be verified');
    async function source(url, format) {
      const response = await fetcher(url,{signal:AbortSignal.timeout(8000)});
      if (!response.ok || response.redirected) throw Error('Source returned HTTP '+response.status);
      return response[format]();
    }
    const checkDay = async date => {
      const [lineup,schedule] = await Promise.allSettled([
        source(rosterUrl+'?date='+date,'text').then(html => openYahooSlots(html,date,starters)),
        source(espnUrl+date.replaceAll('-',''),'json').then(json => upcomingTeams(json,date,now))
      ]);
      return {date, openSlots:lineup.status==='fulfilled'?lineup.value:null, schedule:schedule.status==='fulfilled'?schedule.value:null};
    };
    const daily = await Promise.all(dates.map(checkDay));
    const coverage = daily.map(({date,openSlots,schedule}) => ({date,openSlots,scheduledGames:schedule?.gameCount??null}));
    if (daily.some(day => !day.openSlots || !day.schedule)) {
      const missing = [];
      if (daily.some(day => !day.openSlots)) missing.push('Yahoo lineup');
      if (daily.some(day => !day.schedule)) missing.push('ESPN schedule');
      return {available:false,reason:missing.join(' and ')+' coverage unavailable',week,acquisitions,days:coverage};
    }
    if (availability.freeAgents.count > 0) {
      await collect('FA', page => metadata.push(...page.players));
      const names = new Map(availability.freeAgents.players.map(player => [player.yahooId,player.name]));
      if (metadata.length !== names.size || metadata.some(player => names.get(player.yahooId)!==player.name ||
          !player.nbaTeam || !player.eligiblePositions?.length)) {
        return {available:false,reason:'Current Yahoo free-agent team and position coverage unavailable',week,acquisitions,days:coverage};
      }
    }
    const result = rankStreamingFits(metadata,daily.map(({date,openSlots,schedule})=>({date,openSlots,teams:schedule.teams})),acquisitions);
    return {...result,week,acquisitions,days:coverage};
  } catch {
    return {available:false,reason:'Streaming schedule or eligibility verification failed',week,acquisitions};
  }
}
