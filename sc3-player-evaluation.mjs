import {NINE_CAT,categoryComparison} from './decision-core.mjs';
import {leagueToday} from './yahoo-scoreboard.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
import {buildPerformance} from './player-performance.mjs';
import {verifyMissingYahooPlayers} from './sc3-projection-sources.mjs';
import {resolveVerifiedIdentity} from './sc3-identity-provenance.mjs';
import {buildStreamingPlan} from './sc3-streaming-plan.mjs';
import {readMatchupLineups} from './sc3-matchup-lineups.mjs';
import {readRosterIdentityInputs,rosterIdentityFallback} from './sc3-roster-identity.mjs';

const counting=NINE_CAT.filter(cat=>!cat.includes('%'));
const shotKeys=['FGM','FGA','FTM','FTA'];
const teamAlias={GS:'GSW',NO:'NOP',NY:'NYK',SA:'SAS',WSH:'WAS',BRK:'BKN',UTAH:'UTA',PHO:'PHX'};
const club=team=>teamAlias[team]??team;

function fresh(row,now){
 const age=now.getTime()-Date.parse(row?.observed_at);
 return Number.isFinite(age)&&age>=0&&age<=30*3600_000;
}
export function projectedProduction(averages,count){
 if(!Number.isInteger(count)||count<0||[...counting,...shotKeys].some(key=>!Number.isFinite(averages?.[key])||averages[key]<0)||
    averages.FGM>averages.FGA||averages.FTM>averages.FTA||averages['3PM']>averages.FGM)return null;
 const stats=Object.fromEntries([...counting,...shotKeys].map(key=>[key,averages[key]*count]));
 return {...stats,'FG%':stats.FGA>0?stats.FGM/stats.FGA:null,'FT%':stats.FTA>0?stats.FTM/stats.FTA:null};
}
export function matchupWithPlayer(baseline,addition){
 if(!baseline?.shooting||!addition)return null;
 const own=Object.fromEntries(baseline.rows.map(row=>[row.category,row.ours]));
 const opponent=Object.fromEntries(baseline.rows.map(row=>[row.category,row.opponent]));
 const {FGM,FGA,FTM,FTA}=baseline.shooting;
 if(FGA+addition.FGA<=0||FTA+addition.FTA<=0||FGM+addition.FGM<0||FTM+addition.FTM<0||
  FGM+addition.FGM>FGA+addition.FGA||FTM+addition.FTM>FTA+addition.FTA)return null;
 const after={...Object.fromEntries(counting.map(key=>[key,own[key]+addition[key]])),
  'FG%':(FGM+addition.FGM)/(FGA+addition.FGA),'FT%':(FTM+addition.FTM)/(FTA+addition.FTA)};
 const result=categoryComparison(after,opponent);
 if(!result.verified)return null;
 const before=categoryComparison(own,opponent);
 if(!before.verified)return null;
 const previousLeaders=new Map(before.rows.map(row=>[row.category,row.leader]));
 return {before:before.score,after:result.score,changes:result.rows.map(row=>({
  category:row.category,baseline:own[row.category],withPlayer:row.ours,opponent:row.opponent,
  delta:row.ours-own[row.category],previousLeader:previousLeaders.get(row.category),leader:row.leader
 }))};
}

export function netProduction(incoming,outgoing){
 const keys=[...counting,...shotKeys];
 const valid=values=>values&&keys.every(k=>Number.isFinite(values[k])&&values[k]>=0)&&
  values.FGM<=values.FGA&&values.FTM<=values.FTA&&values['3PM']<=values.FGM;
 if(!valid(incoming)||!valid(outgoing))return null;
 return Object.fromEntries(keys.map(k=>[k,incoming[k]-outgoing[k]]));
}
function nextDay(day){
 return new Date(Date.parse(day+'T12:00:00Z')+86400_000).toISOString().slice(0,10);
}
export function rosterChangeDate(start,status){
 if(!status)return nextDay(start);
 const monthDay=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'});
 let day=start;
 for(let i=0;i<8;i++,day=nextDay(day)){
  if(status==='W ('+monthDay.format(new Date(day+'T12:00:00Z'))+')')return nextDay(day);
 }
 return null;
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

async function readPlayerHistory(espnId,start){
 return espnId?await withScopedTransaction(async c=>{
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
}
export async function readPlayerEvaluation(id,{now=new Date(),fetcher=fetch,dropId=null}={}){
 const start=leagueToday(now);
 const {rows,identity,catalog,rosterLinks}=await withScopedTransaction(async client=>{
  const query=await client.query("select section,payload,observed_at::text from sc3.yahoo_league_snapshots where league_id=85892 and section in ('all_rosters','free_agents','waivers','settings','scoreboard','roster')");
  const rows=Object.fromEntries(query.rows.map(row=>[row.section,row]));
  const found=resolvePlayer(rows,id,now);
  if(!found)return {rows,identity:null,catalog:[],rosterLinks:[]};
  const identity=(await client.query("select espn_id from sc3.sc3_player_identity where status='verified' and yahoo_id=$1",[id])).rows[0]?.espn_id??null;
  const known=(await client.query("select yahoo_id,espn_id,status from sc3.sc3_player_identity where status='verified'")).rows;
  const inputs=await readRosterIdentityInputs(client,now.getTime());
  const rosterLinks=rosterIdentityFallback(inputs.players,known,inputs.catalog);
  const catalog=identity||rosterLinks.some(r=>r.yahoo_id===id)?[]:(await client.query(`
   select e.espn_id as "espnId",e.name,e.nba_team as team,e.birth_date::text as "birthDate"
   from sc3.espn_player_identity e where e.birth_date is not null and not exists
    (select 1 from sc3.sc3_player_identity i where i.espn_id=e.espn_id and i.status='verified')
  `)).rows;
  return {rows,identity,catalog,rosterLinks};
 });
 const found=resolvePlayer(rows,id,now);
 if(!found)return null;
 const {player,ownership,teamKey,fantasyTeam,observedAt}=found;
 const rosterMatch=rosterLinks.find(r=>r.yahoo_id===id);
 const matches=identity||rosterMatch?[]:await verifyMissingYahooPlayers([player],catalog,fetcher);
 const identityVerification=rosterMatch&&!identity?{espnId:rosterMatch.espn_id,source:'YAHOO_ROSTER_AND_ESPN_CATALOG',persisted:false,readOnly:true,evidence:rosterMatch.evidence}:resolveVerifiedIdentity(id,identity,matches);
 const espnId=identityVerification.espnId;
 const history=await readPlayerHistory(espnId,start);
 const analytics=history?.games.length?buildPerformance(history.games,{asOf:now.toISOString(),historyComplete:true}).players?.[0]:null;
 if(analytics)delete analytics.z; // A single player's history cannot produce a league rank.
 const own=teamKey==='478.l.85892.t.5';
 const roster=fresh(rows.all_rosters,now)?rows.all_rosters.payload?.teams?.find(t=>t.key==='478.l.85892.t.5')?.players??[]:[];
 const dropOptions=roster.map(p=>({id:p.yahooId,name:p.name,slot:p.slot})).sort((a,b)=>a.name.localeCompare(b.name));
 const dropPlayer=dropId?roster.find(p=>p.yahooId===dropId):null;
 if(dropId&&!dropPlayer)return {invalidDrop:true};
 const depth=espnId&&!dropId?await withScopedTransaction(async c=>(await c.query(`
   select position,rank,nba_team,injury_marker,observed_at::text from sc3.nba_depth_chart
   where espn_id=$1 order by position,rank
 `,[espnId])).rows).catch(()=>[]):[];
 const profile={...player,ownership,fantasyTeam:fantasyTeam??null,own,observedAt,espnId:espnId??null,identityVerification,depth,analytics,historyThrough:history?.latest??null,historyStatus:!espnId?'IDENTITY_UNRESOLVED':!history?'HISTORY_UNAVAILABLE':history.games.length===0?'NO_REGULAR_SEASON_SAMPLE':history.games.length<3?'INSUFFICIENT_SAMPLE':'READY'};
 const season=await readSeasonSchedule(player,rows.settings,now,fetcher).catch(()=>null);
 const seasonImpact=season&&analytics?.season?.complete&&analytics.season.games>=3
  ? {...season,sampleGames:analytics.season.games,production:projectedProduction(analytics.season.values,season.scheduledGames)}
  : season;
 let report=null, week={reason:'Verified player history or lineup opportunities unavailable'};
 const recent=history?.games.length>=3?history.games.slice(0,10):[];
 const yesterday=new Date(Date.parse(start+'T12:00:00Z')-86400_000).toISOString().slice(0,10);
 const recentRate=recent.length&&history.latest>=yesterday
  ?buildPerformance(recent,{asOf:now.toISOString(),historyComplete:true}).players?.[0]?.season:null;
 if(own){
  week={extraStarts:0,reason:'Already on Salary CAPtain. Adding this player creates no extra starts.'};
  if(recentRate?.complete){
   report=await readMatchupLineups({now,fetcher,includeProjection:!!dropId}).catch(()=>null);
   const existing=report?.complete?report.teams.find(team=>team.id===5)?.players.find(p=>p.yahooId===id):null;
   const dates=existing&&!existing.unknownDates.length?existing.games.filter(game=>game.assignment==='STARTER').map(game=>game.date):null;
   if(dates)week={...week,rosteredStarts:dates.length,dates,production:projectedProduction(recentRate.values,dates.length)};
  }
 }else if(recentRate?.complete){
  const current=await buildStreamingPlan({freeAgents:{count:0},waivers:{count:0,players:[]}},rows,{
   now,fetcher,skipWaiverPlan:true,dropId,evaluationPlayer:{...player,yahooRosterStatus:ownership==='WAIVERS'?player.yahooRosterStatus:null}
  });
  const fit=current.playerScenario;
  if(Number.isInteger(fit?.extraStarts)){
   const production=projectedProduction(recentRate.values,fit.extraStarts);
   report=ownership==='ROSTERED'&&!dropId?null:await readMatchupLineups({now,fetcher,includeProjection:ownership!=='ROSTERED'}).catch(()=>null);
   week={extraStarts:fit.extraStarts,dates:fit.dates,sampleGames:recent.length,production,
    score:matchupWithPlayer(report?.projection?.endOfWeek,production),
    reason:ownership==='ROSTERED'?'This player is on another fantasy team. A trade would change both sides and requires separate terms.':
     !report?.projection?.endOfWeek?'Complete matchup baseline unavailable.':null};
  }
 }
 let comparison=null;
 if(dropPlayer){
  const effectiveOn=rosterChangeDate(start,!own&&ownership==='WAIVERS'?player.yahooRosterStatus:null);
  comparison={drop:{id:dropPlayer.yahooId,name:dropPlayer.name},effectiveOn,dropOnly:own,
   week:null,season:null,reason:'Weekly comparison requires verified upcoming lineup slots and both players’ recent history.'};
  if(effectiveOn){
   const dropEspn=rosterLinks.find(r=>r.yahoo_id===dropId)?.espn_id??await withScopedTransaction(async client=>(await client.query(
    "select espn_id from sc3.sc3_player_identity where status='verified' and yahoo_id=$1",[dropId]
   )).rows[0]?.espn_id);
   const dropHistory=await readPlayerHistory(dropEspn,start);
   const dropAnalytics=dropHistory?.games.length?buildPerformance(dropHistory.games,{asOf:now.toISOString(),historyComplete:true}).players?.[0]:null;
   const dropRecent=dropHistory?.games.length>=3&&dropHistory.latest>=yesterday
    ?buildPerformance(dropHistory.games.slice(0,10),{asOf:now.toISOString(),historyComplete:true}).players?.[0]?.season:null;
   const dropSchedule=await readSeasonSchedule(dropPlayer,rows.settings,now,fetcher).catch(()=>null);
   if(dropSchedule&&dropAnalytics?.season?.complete&&dropAnalytics.season.games>=3&&(own||season&&analytics?.season?.complete&&analytics.season.games>=3)){
    const removedGames=dropSchedule.dates.filter(date=>date>=effectiveOn).length;
    const addedGames=own?0:season.dates.filter(date=>date>=effectiveOn).length;
    const incoming=projectedProduction(own?dropAnalytics.season.values:analytics.season.values,addedGames);
    const outgoing=projectedProduction(dropAnalytics.season.values,removedGames);
    comparison.season={addedGames,removedGames,through:dropSchedule.yahooEnd,incoming,outgoing,net:netProduction(incoming,outgoing)};
   }
   if(!report&&dropRecent?.complete)report=await readMatchupLineups({now,fetcher,includeProjection:ownership!=='ROSTERED'||own}).catch(()=>null);
   const outgoingPlayer=report?.complete?report.teams.find(team=>team.id===5)?.players.find(p=>p.yahooId===dropId):null;
   const removedDates=outgoingPlayer&&!outgoingPlayer.unknownDates.length
    ?outgoingPlayer.games.filter(game=>game.assignment==='STARTER'&&game.date>=effectiveOn).map(game=>game.date):null;
   if(removedDates&&dropRecent?.complete&&(own||week.production)){
    const incoming=own?projectedProduction(dropRecent.values,0):week.production;
    const outgoing=projectedProduction(dropRecent.values,removedDates.length);
    const net=netProduction(incoming,outgoing);
    comparison.week={addedDates:own?[]:week.dates,removedDates,incoming,outgoing,net,
     score:ownership!=='ROSTERED'||own?matchupWithPlayer(report.projection?.endOfWeek,net):null};
    comparison.reason=!own&&ownership==='ROSTERED'?'An opponent player requires a trade. The comparison does not change the opponent’s lineup.':
     !comparison.week.score?'Full week-end score unavailable. The stat deltas below are still available.':null;
   }
  }else comparison.reason='The next eligible roster date could not be confirmed from Yahoo.';
 }
 return {mode:'SC3_PLAYER_EVALUATION',profile,week,season:seasonImpact,dropOptions,comparison,readOnly:true};
}
