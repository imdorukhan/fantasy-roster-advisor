import {readWaiverOpportunities} from './sc3-waiver-plan.mjs';
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

export function yahooWindow(rows, now) {
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
    acquisitions: {limit:Number(limit), used:Number(used), remaining:Number(limit) - Number(used), observedAt:roster.observed_at,
      fab:/^\d+$/.test(String(teamMeta.find(part=>part?.faab_balance!==undefined)?.faab_balance))?Number(teamMeta.find(part=>part?.faab_balance!==undefined).faab_balance):null}
  };
}

export function datedYahooRows(html, day, teamId) {
  if (!Number.isInteger(teamId) || teamId < 1 || teamId > 14) throw Error('Unexpected Yahoo team');
  const options = [...html.matchAll(/<option\b[^>]*\bvalue=['"]([^'"]+)['"][^>]*\bselected(?:\s*=\s*['"][^'"]*['"])?\s*>/gi)];
  const dateVerified = options.some(([, href]) => {
    const url = new URL(href.replaceAll('&amp;', '&'), rosterUrl);
    return url.origin === new URL(rosterUrl).origin && url.pathname === '/nba/85892/'+teamId+'/team' && url.searchParams.get('date') === day;
  });
  if (!dateVerified) throw Error('Yahoo lineup date and team could not be verified');
  const table = html.match(/<table\b[^>]*\bid=["']statTable0["'][^>]*>[\s\S]*?<\/table>/i)?.[0];
  const body = table?.match(/<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i)?.[1];
  if (!body) throw Error('Yahoo lineup table missing');
  function plain(value) {
    const entities = {amp:'&', apos:"'", quot:'"', lt:'<', gt:'>', nbsp:' '};
    return value?.replace(/<[^>]+>/g,'').replace(/&(#x[0-9a-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi,(_,entity)=>{
      if(entity.startsWith('#'))return String.fromCodePoint(entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1)));
      return entities[entity.toLowerCase()];
    }).trim();
  }
  return [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, row]) => {
    const player = row.match(/<a\b[^>]*\bclass=["'][^"']*\bname\b[^"']*["'][^>]*\bdata-ys-playerid=["'](\d+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const team = row.match(/<span\s+class=["']Fz-xxs["']>\s*([A-Z]{2,3})\s*-\s*([^<]+)<\/span>/i);
    return {
      slot: row.match(/\bdata-pos=["']([^"']+)["']/i)?.[1],
      occupied: /\bdata-ys-playerid=["']\d+["']/i.test(row),
      empty: />\s*(?:\(Empty\)|Empty)\s*</i.test(row),
      yahooId:player?.[1], name:plain(player?.[2]), nbaTeam:team ? nbaTeam(team[1]) : null,
      eligiblePositions:team?.[2].split(',').map(value=>value.trim()).filter(value=>/^(PG|SG|SF|PF|C)$/.test(value))??[]
    };
  });
}

export function openYahooSlots(html, day, starters) {
  return openSlotsFromRows(datedYahooRows(html,day,5),starters);
}

function openSlotsFromRows(rows,starters){
  const open = [];
  for (const {position, count} of starters) {
    const matches = rows.filter(row => row.slot === position);
    if (matches.length !== count || matches.some(row => !row.occupied && !row.empty)) throw Error('Yahoo lineup slot coverage could not be verified');
    for (const row of matches) if (!row.occupied) open.push(position);
  }
  return open;
}

export function upcomingTeams(json, date, now, baseline) {
  if (json?.leagues?.[0]?.slug !== 'nba' || !Array.isArray(json.events)) throw Error('ESPN NBA scoreboard could not be verified');
  const teams = new Set();
  let baselineAligned = true;
  for (const game of json.events) {
    const start = Date.parse(game.date);
    const competitors = game.competitions?.[0]?.competitors?.map(entry => nbaTeam(entry.team?.abbreviation));
    if (!Number.isFinite(start) || leagueToday(new Date(start)) !== date ||
        competitors?.length !== 2 || new Set(competitors).size !== 2 || competitors.some(team => !/^[A-Z]{2,3}$/.test(team)) ||
        !['pre','in','post'].includes(game.status?.type?.state)) throw Error('ESPN game coverage could not be verified');
    if (baseline && (game.status.type.state==='in' || start>=baseline.getTime() && start<=now.getTime())) baselineAligned = false;
    if (start > now.getTime() && game.status.type.state === 'pre' && game.status.type.name === 'STATUS_SCHEDULED') {
      for (const team of competitors) teams.add(team);
    }
  }
  return {teams, gameCount:json.events.length, baselineAligned};
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
        source(rosterUrl+'?date='+date,'text').then(html=>{
          const rows=datedYahooRows(html,date,5);
          return {rows,open:openSlotsFromRows(rows,starters)};
        }),
        source(espnUrl+date.replaceAll('-',''),'json').then(json => upcomingTeams(json,date,now))
      ]);
      return {date, openSlots:lineup.status==='fulfilled'?lineup.value.open:null, lineup:lineup.status==='fulfilled'?lineup.value.rows:null, schedule:schedule.status==='fulfilled'?schedule.value:null};
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
    const waiverPlan=await readWaiverOpportunities(availability.waivers,daily,starters,acquisitions,fetcher)
      .catch(()=>({error:'Current Yahoo waiver candidates unavailable'}));
    return {...result,week,acquisitions,days:coverage,waiverPlan};
  } catch {
    return {available:false,reason:'Streaming schedule or eligibility verification failed',week,acquisitions};
  }
}
