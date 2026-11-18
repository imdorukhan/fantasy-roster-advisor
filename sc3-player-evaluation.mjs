import {NINE_CAT,categoryComparison} from './decision-core.mjs';
import {leagueToday} from './yahoo-scoreboard.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
import {buildPerformance} from './player-performance.mjs';
import {verifyMissingYahooPlayers} from './sc3-projection-sources.mjs';
import {buildStreamingPlan} from './sc3-streaming-plan.mjs';
import {readMatchupLineups} from './sc3-matchup-lineups.mjs';

const counting=NINE_CAT.filter(cat=>!cat.includes('%'));
const shotKeys=['FGM','FGA','FTM','FTA'];
const teamAlias={GS:'GSW',NO:'NOP',NY:'NYK',SA:'SAS',WSH:'WAS',BRK:'BKN',UTAH:'UTA',PHO:'PHX'};
const club=team=>teamAlias[team]??team;

function fresh(row,now){
 const age=now.getTime()-Date.parse(row?.observed_at);
 return Number.isFinite(age)&&age>=0&&age<=30*3600_000;
}
export function projectedProduction(averages,count){
 if(!Number.isInteger(count)||count<0||[...counting,...shotKeys].some(key=>!Number.isFinite(averages?.[key])||averages[key]<0))return null;
 const stats=Object.fromEntries([...counting,...shotKeys].map(key=>[key,averages[key]*count]));
 return {...stats,'FG%':stats.FGA>0?stats.FGM/stats.FGA:null,'FT%':stats.FTA>0?stats.FTM/stats.FTA:null};
}
export function matchupWithPlayer(baseline,addition){
 if(!baseline?.shooting||!addition)return null;
 const own=Object.fromEntries(baseline.rows.map(row=>[row.category,row.ours]));
 const opponent=Object.fromEntries(baseline.rows.map(row=>[row.category,row.opponent]));
 const {FGM,FGA,FTM,FTA}=baseline.shooting;
 if(FGA+addition.FGA<=0||FTA+addition.FTA<=0)return null;
 const after={...Object.fromEntries(counting.map(key=>[key,own[key]+addition[key]])),
  'FG%':(FGM+addition.FGM)/(FGA+addition.FGA),'FT%':(FTM+addition.FTM)/(FTA+addition.FTA)};
 const result=categoryComparison(after,opponent);
 if(!result.verified)return null;
 return {before:baseline.score,after:result.score,changes:result.rows.map(row=>({
  category:row.category,baseline:own[row.category],withPlayer:row.ours,opponent:row.opponent,leader:row.leader
 }))};
}

export function scheduledSeasonGames(data,nbaTeam,season,now,yahooEnd){
 if(club(data?.team?.abbreviation)!==club(nbaTeam)||data.season?.year!==season||Number(data.season?.type)!==2||
    !Array.isArray(data.events)||data.events.length<75)throw Error('ESPN season schedule coverage unavailable');
 const seen=new Set();
 const dates=[];
 for(const event of data.events){
  const tip=Date.parse(event.date);
  const game=event.competitions?.[0];
  if(!/^\d+$/.test(event.id)||seen.has(event.id)||!Number.isFinite(tip)||Number(event.seasonType?.type)!==2||
     !game?.competitors?.some(p=>club(p.team?.abbreviation)===club(nbaTeam)))throw Error('Invalid ESPN schedule event');
  seen.add(event.id);
  const date=leagueToday(new Date(tip));
  if(tip>now.getTime()&&date<=yahooEnd&&game.status?.type?.name==='STATUS_SCHEDULED')dates.push(date);
 }
 return dates.sort();
}

async function readSeasonSchedule(player,settings,now,fetcher){
 const league=settings?.payload?.league?.[0];
 const yahooEnd=league?.end_date, season=Number(league?.season)+1;
 if(!fresh(settings,now)||!/^\d{4}-\d{2}-\d{2}$/.test(yahooEnd)||!Number.isInteger(season)||!/^[A-Z]{2,3}$/.test(player.nbaTeam))return null;
 const url='https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/'+player.nbaTeam+'/schedule?season='+season+'&seasontype=2';
 const r=await fetcher(url,{signal:AbortSignal.timeout(6500),redirect:'error'});
 if(!r.ok)throw Error('ESPN schedule unavailable');
 const dates=scheduledSeasonGames(await r.json(),player.nbaTeam,season,now,yahooEnd);
 return {yahooEnd,scheduledGames:dates.length,dates,source:'ESPN NBA schedule'};
}

function resolvePlayer(rows,id,now){
 const found=[];
 const rosters=rows.all_rosters;
 if(fresh(rosters,now)&&rosters.payload?.complete===true){
  for(const team of rosters.payload.teams??[]){
   for(const player of team.players??[])if(player.yahooId===id)found.push({player,teamKey:team.key,fantasyTeam:team.name,ownership:'ROSTERED',observedAt:rosters.observed_at});
  }
 }
 for(const [section,ownership] of [['free_agents','FREE_AGENT'],['waivers','WAIVERS']]){
  const row=rows[section];
  if(!fresh(row,now)||row.payload?.complete!==true||row.payload?.individualOwnershipVerified!==true)continue;
  for(const player of row.payload.players??[])if(player.yahooId===id)found.push({player,ownership,observedAt:row.observed_at});
 }
 return found.length===1?found[0]:null;
}

export async function readPlayerEvaluation(id,{now=new Date(),fetcher=fetch}={}){
 const start=leagueToday(now);
 const {rows,identity,catalog}=await withScopedTransaction(async client=>{
  const query=await client.query("select section,payload,observed_at::text from sc3.yahoo_league_snapshots where league_id=85892 and section in ('all_rosters','free_agents','waivers','settings','scoreboard','roster')");
  const rows=Object.fromEntries(query.rows.map(row=>[row.section,row]));
  const found=resolvePlayer(rows,id,now);
  if(!found)return {rows,identity:null,catalog:[]};
  const identity=(await client.query("select espn_id from sc3.sc3_player_identity where status='verified' and yahoo_id=$1",[id])).rows[0]?.espn_id??null;
  const catalog=identity?[]:(await client.query(`
   select e.espn_id as "espnId",e.name,e.nba_team as team,e.birth_date::text as "birthDate"
   from sc3.espn_player_identity e where e.birth_date is not null and not exists
    (select 1 from sc3.sc3_player_identity i where i.espn_id=e.espn_id and i.status='verified')
  `)).rows;
  return {rows,identity,catalog};
 });
 const found=resolvePlayer(rows,id,now);
 if(!found)return null;
 const {player,ownership,teamKey,fantasyTeam,observedAt}=found;
 const espnId=identity??(await verifyMissingYahooPlayers([player],catalog,fetcher))[0]?.espnId;
 const history=espnId?await withScopedTransaction(async c=>{
  const latest=(await c.query("select max(game_day)::text as latest from sc3.sc3_nba_sync_days where status='complete' and game_day<$1::date",[start])).rows[0]?.latest;
  if(!latest)return null;
  const games=(await c.query(`
   select l.event_id as "eventId",l.espn_id as "espnId",l.tipoff::text as date,l.player_name as name,l.nba_team as team,l.stats
   from sc3.sc3_nba_game_logs l join sc3.sc3_nba_sync_days d using(game_day)
   where l.espn_id=$1 and l.game_day<=$2::date and d.status='complete'
   order by l.game_day desc,l.tipoff desc,l.event_id desc
  `,[espnId,latest])).rows;
  return {latest,games};
 }):null;
 const analytics=history?.games.length?buildPerformance(history.games,{asOf:now.toISOString(),historyComplete:true}).players?.[0]:null;
 if(analytics)delete analytics.z; // A single player's history cannot produce a league rank.
 const own=teamKey==='478.l.85892.t.5';
 const depth=espnId?await withScopedTransaction(async c=>(await c.query(`
   select position,rank,nba_team,injury_marker,observed_at::text from sc3.nba_depth_chart
   where espn_id=$1 order by position,rank
 `,[espnId])).rows).catch(()=>[]):[];
 const profile={...player,ownership,fantasyTeam:fantasyTeam??null,own,observedAt,espnId:espnId??null,depth,analytics,historyThrough:history?.latest??null};
 const season=await readSeasonSchedule(player,rows.settings,now,fetcher).catch(()=>null);
 const seasonImpact=season&&analytics?.season?.complete&&analytics.season.games>=3
  ? {...season,sampleGames:analytics.season.games,production:projectedProduction(analytics.season.values,season.scheduledGames)}
  : season;
 let week={reason:'Verified player history or lineup opportunities unavailable'};
 const recent=history?.games.length>=3?history.games.slice(0,10):[];
 const yesterday=new Date(Date.parse(start+'T12:00:00Z')-86400_000).toISOString().slice(0,10);
 const recentRate=recent.length&&history.latest>=yesterday
  ?buildPerformance(recent,{asOf:now.toISOString(),historyComplete:true}).players?.[0]?.season:null;
 if(own){
  week={extraStarts:0,reason:'Already on Salary CAPtain. Adding this player creates no extra starts.'};
  if(recentRate?.complete){
   const report=await readMatchupLineups({now,fetcher}).catch(()=>null);
   const existing=report?.complete?report.teams.find(team=>team.id===5)?.players.find(p=>p.yahooId===id):null;
   const dates=existing&&!existing.unknownDates.length?existing.games.filter(game=>game.assignment==='STARTER').map(game=>game.date):null;
   if(dates)week={...week,rosteredStarts:dates.length,dates,production:projectedProduction(recentRate.values,dates.length)};
  }
 }else if(recentRate?.complete){
  const current=await buildStreamingPlan({freeAgents:{count:0},waivers:{count:0,players:[]}},rows,{
   now,fetcher,skipWaiverPlan:true,evaluationPlayer:{...player,yahooRosterStatus:ownership==='WAIVERS'?player.yahooRosterStatus:null}
  });
  const fit=current.playerScenario;
  if(Number.isInteger(fit?.extraStarts)){
   const production=projectedProduction(recentRate.values,fit.extraStarts);
   const report=ownership==='ROSTERED'?null:await readMatchupLineups({now,fetcher,includeProjection:true}).catch(()=>null);
   week={extraStarts:fit.extraStarts,dates:fit.dates,sampleGames:recent.length,production,
    score:matchupWithPlayer(report?.projection?.endOfWeek,production),
    reason:ownership==='ROSTERED'?'This player is on another fantasy team. A trade would change both sides and requires separate terms.':
     !report?.projection?.endOfWeek?'Complete matchup baseline unavailable.':null};
  }
 }
 return {mode:'SC3_PLAYER_EVALUATION',profile,week,season:seasonImpact,readOnly:true};
}
