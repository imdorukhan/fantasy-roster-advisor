import {NINE_CAT,categoryComparison,freshness} from './decision-core.mjs';
import {leagueToday} from './yahoo-scoreboard.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
import {verifyMissingYahooPlayers} from './sc3-projection-sources.mjs';

const counting = NINE_CAT.filter(key=>!key.includes('%'));
const keys = [...counting,'FGM','FGA','FTM','FTA'];
const zero = () => Object.fromEntries(keys.map(key=>[key,0]));
const rate = (made,attempted) => attempted>0?made/attempted:null;

function validStats(stats){
 return keys.every(key=>Number.isSafeInteger(stats?.[key])&&stats[key]>=0) &&
   stats.FGM<=stats.FGA && stats.FTM<=stats.FTA;
}
function totals(stats){
 return {...Object.fromEntries(counting.map(key=>[key,stats[key]])),
   'FG%':rate(stats.FGM,stats.FGA),'FT%':rate(stats.FTM,stats.FTA)};
}
function combine(team, future){
 const shots=team.shooting;
 if (!shots || !['FGM','FGA','FTM','FTA'].every(key=>Number.isSafeInteger(shots[key]))) return null;
 if ([['FG%','FGM','FGA'],['FT%','FTM','FTA']].some(([category,made,attempted])=>
   Math.abs((rate(shots[made],shots[attempted])??0)-team.stats[category])>0.00051)) return null;
 return totals(Object.fromEntries(keys.map(key=>[key,(shots[key]??team.stats[key])+future[key]])));
}

export function matchupProjection(report, official, logs, historyThrough, {now=new Date(),baselineAligned=false}={}){
 const histories=new Map();
 for(const {yahoo_id,stats} of logs){
   if (!histories.has(yahoo_id)) histories.set(yahoo_id,[]);
   histories.get(yahoo_id).push(stats);
 }
 const results=report.teams.map(team=>{
   const summed=zero();
   let expected=0,covered=0;
   const missing=[];
   for (const player of team.players){
     const starts=player.games.filter(game=>game.assignment==='STARTER').length;
     if (starts===0) continue;
     expected+=starts;
     const sample=histories.get(player.yahooId)??[];
     if (!historyThrough||sample.length<3||sample.length>10||sample.some(stats=>!validStats(stats))){
       missing.push({name:player.name,starts});
       continue;
     }
     covered+=starts;
     for (const key of keys) summed[key]+=sample.reduce((sum,stats)=>sum+stats[key],0)*starts/sample.length;
   }
   const unknownSchedule=team.players.filter(player=>player.unknownDates.length).map(player=>player.name);
   return {id:team.id,name:team.name,expected,covered,missing,unknownSchedule,summed,
     future:covered>0||expected===0&&report.complete&&unknownSchedule.length===0?totals(summed):null};
 });
 const teams=results.map(({summed,...team})=>team);
 const reasons=[];
 if (!report.complete||teams.some(team=>team.unknownSchedule.length)) reasons.push('Daily lineup or NBA schedule coverage incomplete');
 if (teams.some(team=>team.covered!==team.expected)) reasons.push('Verified Yahoo–ESPN player history missing');
 if (!historyThrough||historyThrough<new Date(Date.parse(leagueToday(now)+'T12:00:00Z')-86400_000).toISOString().slice(0,10)) reasons.push('Latest completed NBA history not yet synced');
 if (!baselineAligned||!freshness(official.observedAt,{now:now.getTime()}).valid||leagueToday(new Date(official.observedAt))!==leagueToday(now)){
   reasons.push('Yahoo scoreboard is too old or out of sync with the upcoming-games window');
 }
 let endOfWeek=null;
 if (!reasons.length){
   const ours=combine(official.ourTeam,results[0].summed);
   const opponent=combine(official.opponent,results[1].summed);
   const comparison=ours&&opponent?categoryComparison(ours,opponent):null;
   if (comparison?.verified) endOfWeek={rows:comparison.rows,score:comparison.score};
   else reasons.push('Verified Yahoo shooting totals or projected denominators unavailable');
 }
 return {teams,historyThrough,baseline:{source:official.source,observedAt:official.observedAt},blocked:reasons,endOfWeek,readOnly:true};
}

export async function readMatchupProjection(report,official,options){
 const players=new Map();
 for(const team of report.teams)for(const player of team.players){
   const teams=[...new Set(player.games.filter(game=>game.assignment==='STARTER').map(game=>game.nbaTeam))];
   if(teams.length===1)players.set(player.yahooId,{yahooId:player.yahooId,name:player.name,nbaTeam:teams[0]});
 }
 const ids=[...new Set(report.teams.flatMap(team=>team.players.filter(player=>player.games.some(game=>game.assignment==='STARTER')).map(player=>player.yahooId)))];
 const before=leagueToday(options.now);
 const {verified,catalog,historyThrough}=await withScopedTransaction(async client=>{
   const cutoff=(await client.query("select max(game_day)::text as latest from sc3.sc3_nba_sync_days where status='complete' and game_day<$1::date",[before])).rows[0]?.latest??null;
   if (!cutoff||!ids.length) return {verified:[],catalog:[],historyThrough:cutoff};
   const verified=(await client.query("select yahoo_id,espn_id from sc3.sc3_player_identity where status='verified' and yahoo_id=any($1::text[])",[ids])).rows;
   const catalog=verified.length===ids.length?[]:(await client.query(`
     select e.espn_id as "espnId",e.name,e.nba_team as team,e.birth_date::text as "birthDate"
     from sc3.espn_player_identity e
     where e.birth_date is not null and not exists
       (select 1 from sc3.sc3_player_identity i where i.espn_id=e.espn_id and i.status='verified')
   `)).rows;
   return {verified,catalog,historyThrough:cutoff};
 });
 const known=new Set(verified.map(row=>row.yahoo_id));
 const missing=[...players.values()].filter(player=>!known.has(player.yahooId));
 const linked=catalog.length&&missing.length?await verifyMissingYahooPlayers(missing,catalog,options.fetcher):[];
 const pairs=[...verified,...linked.map(row=>({yahoo_id:row.yahooId,espn_id:row.espnId}))];
 const logs=historyThrough&&pairs.length?await withScopedTransaction(async client=>(await client.query(`
     select i.yahoo_id,g.stats
     from jsonb_to_recordset($1::jsonb) as i(yahoo_id text,espn_id text)
     cross join lateral (
       select l.stats from sc3.sc3_nba_game_logs l
       join sc3.sc3_nba_sync_days d using(game_day)
       where l.espn_id=i.espn_id and l.game_day<=$2::date and d.status='complete'
       order by l.game_day desc,l.tipoff desc,l.event_id desc limit 10
     ) g`,[JSON.stringify(pairs),historyThrough])).rows):[];
 return matchupProjection(report,official,logs,historyThrough,options);
}
