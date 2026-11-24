import {datedYahooRows,upcomingTeams,fetchScheduleSource} from './sc3-streaming-plan.mjs';
import {leagueToday,officialMatchupFromScoreboard,currentMatchupIdentityFromScoreboard} from './yahoo-scoreboard.mjs';
import {bridgeSnapshots} from './sc3-yahoo-bridge.mjs';
import {readMatchupProjection} from './sc3-matchup-projection.mjs';
import {readYahooPageBaseline} from './sc3-projection-sources.mjs';
import {freshness} from './decision-core.mjs';

const yahoo = 'https://basketball.fantasysports.yahoo.com/nba/85892/';
const espn = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=';

export function lineupSlots(rows, config, upcoming) {
  const recognized = new Map();
  for (const position of config) {
    const matches = rows.filter(row => row.slot === position.position);
    if (matches.length !== position.count || matches.some(row => !row.occupied && !row.empty)) throw Error('Yahoo daily lineup slot coverage is incomplete');
    recognized.set(position.position, position.is_starting_position ? 'STARTER' : position.position==='BN'?'BENCH':'IL');
  }
  const occupied = rows.filter(row => row.occupied);
  if (occupied.some(row => !recognized.has(row.slot) || !row.yahooId || !row.name) ||
    new Set(occupied.map(row => row.yahooId)).size!==occupied.length) throw Error('Yahoo daily players could not be verified');
  return occupied.map(({yahooId,name,nbaTeam,slot})=>({
    yahooId,name,nbaTeam,slot,assignment:recognized.get(slot),
    upcoming:nbaTeam ? upcoming.has(nbaTeam) : null
  }));
}

function groupPlayers(days, id) {
  const players = new Map();
  for (const day of days) {
    const lineup = day.lineups.find(x=>x.id===id);
    for (const player of lineup.players) {
      if (!players.has(player.yahooId)) players.set(player.yahooId,{yahooId:player.yahooId,name:player.name,games:[],unknownDates:[]});
      const entry = players.get(player.yahooId);
      if (player.upcoming===null) entry.unknownDates.push(day.date);
      if (player.upcoming) entry.games.push({date:day.date,nbaTeam:player.nbaTeam,slot:player.slot,assignment:player.assignment});
    }
  }
  return [...players.values()].sort((a,b)=>a.name.localeCompare(b.name));
}

export async function readMatchupLineups({now=new Date(),fetcher=fetch,includeProjection=false,includeForecast=false,loadSnapshots=bridgeSnapshots}={}) {
  const snapshots = await loadSnapshots();
  const scoreOptions={observedAt:snapshots.scoreboard?.observed_at,now};
  // Week identity and daily lineup coverage do not depend on published 9-CAT totals.
  const week=currentMatchupIdentityFromScoreboard(snapshots.scoreboard?.payload,scoreOptions);
  let scored=null;
  try { scored=officialMatchupFromScoreboard(snapshots.scoreboard?.payload,scoreOptions); }
  catch { /* The current week exists but scores may be missing or unverified. */ }
  const official=scored||week;
  const settingsAge=now.getTime()-Date.parse(snapshots.settings?.observed_at);
  if (!Number.isFinite(settingsAge) || settingsAge<0 || settingsAge>30*3600_000) throw Error('Yahoo settings snapshot unavailable');
  const config=snapshots.settings?.payload?.league?.[1]?.settings?.[0]?.roster_positions?.map(entry=>entry?.roster_position);
  if (!config?.length || new Set(config.map(slot=>slot?.position)).size!==config.length ||
      config.some(slot=>!/^(PG|SG|G|SF|PF|F|C|FC|Util|BN|IL|IL\+|IR|IR\+)$/.test(slot?.position) ||
        !Number.isInteger(slot.count)||slot.count<1||![0,1].includes(slot.is_starting_position)) ||
      !config.some(slot=>slot.is_starting_position===1)) throw Error('Yahoo lineup settings could not be verified');
  const ids=[official.ourTeam.id,official.opponent.id];
  const dates=[];
  const date = new Date(leagueToday(now)+'T12:00:00Z');
  while(date.toISOString().slice(0,10)<=official.weekEnd && dates.length<8){
    dates.push(date.toISOString().slice(0,10));
    date.setUTCDate(date.getUTCDate()+1);
  }
  if(!dates.length||dates.at(-1)!==official.weekEnd)throw Error('Yahoo matchup date range could not be verified');

  async function source(url, format) {
    return fetchScheduleSource(url,format,fetcher);
  }
  const baseline = scored&&includeProjection&&!freshness(scored.observedAt,{now:now.getTime()}).valid
    ? await readYahooPageBaseline(scored,now,fetcher).catch(()=>scored)
    : scored||week;
  const days = await Promise.all(dates.map(async date=>{
    const [schedule,...teams]=await Promise.allSettled([
      source(espn+date.replaceAll('-',''),'json').then(data=>upcomingTeams(data,date,now,new Date(baseline.observedAt))),
      ...ids.map(id=>source(yahoo+id+'?date='+date,'text').then(html=>datedYahooRows(html,date,id)))
    ]);
    const lineups=teams.map((team,i)=>{
      try{
        if(team.status!=='fulfilled'||schedule.status!=='fulfilled')throw Error('Coverage unavailable');
        return {id:ids[i],verified:true,players:lineupSlots(team.value,config,schedule.value.teams)};
      }catch{return {id:ids[i],verified:false,players:[]};}
    });
    return {date,scheduleVerified:schedule.status==='fulfilled',baselineAligned:schedule.status==='fulfilled' && schedule.value.baselineAligned,lineups};
  }));
  const report = {
    mode:'SC3_MATCHUP_LINEUPS',week:official.week,weekStart:official.weekStart,weekEnd:official.weekEnd,scoreboardObservedAt:official.observedAt,
    observedAt:now.toISOString(),readOnly:true,scoreVerified:Boolean(scored),
    complete:days.every(day=>day.scheduleVerified&&day.lineups.every(team=>team.verified)),
    days:days.map(({date,scheduleVerified,lineups})=>({date,scheduleVerified,lineups:lineups.map(({id,verified})=>({id,verified}))})),
    teams:[official.ourTeam,official.opponent].map(team=>({id:team.id,name:team.name,players:groupPlayers(days,team.id)}))
  };
  if(includeProjection){
    if(!scored)report.projection={teams:[],blocked:['Official Yahoo 9-CAT totals not yet verified'],endOfWeek:null,readOnly:true};
    else {
      try{report.projection=await readMatchupProjection(report,baseline,{now,fetcher,includeForecast,baselineAligned:days.every(day=>day.baselineAligned)});}
      catch{report.projection={teams:[],blocked:['Verified NBA history unavailable'],endOfWeek:null,readOnly:true};}
    }
  }
  return report;
}
