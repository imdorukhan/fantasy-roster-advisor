import {datedYahooRows,upcomingTeams} from './sc3-streaming-plan.mjs';
import {leagueToday,officialMatchupFromScoreboard} from './yahoo-scoreboard.mjs';
import {bridgeSnapshots} from './sc3-yahoo-bridge.mjs';

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

export async function readMatchupLineups({now=new Date(),fetcher=fetch}={}) {
  const snapshots = await bridgeSnapshots();
  const official = officialMatchupFromScoreboard(snapshots.scoreboard?.payload,{observedAt:snapshots.scoreboard?.observed_at,now});
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
    const response = await fetcher(url,{signal:AbortSignal.timeout(8000)});
    if (!response.ok || response.redirected) throw Error('Source unavailable');
    return response[format]();
  }
  const days = await Promise.all(dates.map(async date=>{
    const [schedule,...teams]=await Promise.allSettled([
      source(espn+date.replaceAll('-',''),'json').then(data=>upcomingTeams(data,date,now)),
      ...ids.map(id=>source(yahoo+id+'?date='+date,'text').then(html=>datedYahooRows(html,date,id)))
    ]);
    const lineups=teams.map((team,i)=>{
      try{
        if(team.status!=='fulfilled'||schedule.status!=='fulfilled')throw Error('Coverage unavailable');
        return {id:ids[i],verified:true,players:lineupSlots(team.value,config,schedule.value.teams)};
      }catch{return {id:ids[i],verified:false,players:[]};}
    });
    return {date,scheduleVerified:schedule.status==='fulfilled',lineups};
  }));
  return {
    mode:'SC3_MATCHUP_LINEUPS',week:official.week,scoreboardObservedAt:official.observedAt,
    observedAt:now.toISOString(),readOnly:true,
    complete:days.every(day=>day.scheduleVerified&&day.lineups.every(team=>team.verified)),
    days:days.map(({date,scheduleVerified,lineups})=>({date,scheduleVerified,lineups:lineups.map(({id,verified})=>({id,verified}))})),
    teams:[official.ourTeam,official.opponent].map(team=>({id:team.id,name:team.name,players:groupPlayers(days,team.id)}))
  };
}
