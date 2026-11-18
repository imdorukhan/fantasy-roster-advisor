import {NINE_CAT} from './decision-core.mjs';
import {readYahooPageBaseline,verifyMissingYahooPlayers} from './sc3-projection-sources.mjs';
import {leagueToday} from './yahoo-scoreboard.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';

const raw=[...NINE_CAT.filter(cat=>!cat.includes('%')),'FGM','FGA','FTM','FTA'];
function valid(stats){
 return raw.every(key=>Number.isSafeInteger(stats?.[key])&&stats[key]>=0)&&stats.FGM<=stats.FGA&&stats.FTM<=stats.FTA;
}

export function candidateImpact(samples,starts,matchup){
 if(!Number.isInteger(starts)||starts<1||samples.length<3||samples.length>10||samples.some(s=>!valid(s)))return null;
 const totals=Object.fromEntries(raw.map(key=>[key,samples.reduce((sum,s)=>sum+s[key],0)*starts/samples.length]));
 const own=matchup.ourTeam.stats,other=matchup.opponent.stats,shots=matchup.ourTeam.shooting;
 const delta={};
 const progress={};
 for(const cat of NINE_CAT){
  const percent=cat==='FG%'||cat==='FT%';
  const direction=cat==='TO'?-1:1;
  const margin=(own[cat]-other[cat])*direction;
  if(percent){
   const made=cat==='FG%'?'FGM':'FTM', tried=cat==='FG%'?'FGA':'FTA';
   if(!shots||!Number.isSafeInteger(shots[made])||!Number.isSafeInteger(shots[tried])||shots[tried]<=0||
     Math.abs(shots[made]/shots[tried]-own[cat])>0.00051) return null;
   delta[cat]=(shots[made]+totals[made])/(shots[tried]+totals[tried])-shots[made]/shots[tried];
  }else delta[cat]=totals[cat];
  if(margin<=0){
   const scale=Math.max(-margin,percent?0.005:1);
   progress[cat]=Math.max(-1,Math.min(1,delta[cat]*direction/scale));
  }
 }
 return {games:samples.length,delta,progress,score:Object.values(progress).reduce((total,v)=>total+v,0)};
}

export function applyWaiverImpact(rows,logs,matchup){
 const byId=new Map();
 for(const {yahoo_id,stats} of logs){
  if(!byId.has(yahoo_id))byId.set(yahoo_id,[]);
  byId.get(yahoo_id).push(stats);
 }
 return rows.map(row=>({...row,impact:candidateImpact(byId.get(row.yahooId)??[],row.extraStarts,matchup)}))
  .sort((a,b)=>(b.extraStarts??-1)-(a.extraStarts??-1)||
   (b.impact?.score??-10)-(a.impact?.score??-10)||a.name.localeCompare(b.name));
}

export async function enrichWaiverImpact(waiverPlan,matchup,{now,fetcher=fetch}){
 const candidates=waiverPlan.rows.filter(row=>row.extraStarts>0&&row.nbaTeam);
 if(!candidates.length)return {...waiverPlan,impactStatus:'No candidates with extra starts to evaluate',impactCoverage:0};
 const baseline=await readYahooPageBaseline(matchup,now,fetcher).catch(()=>null);
 if(!baseline)return {...waiverPlan,impactStatus:'Current Yahoo matchup baseline unavailable',impactCoverage:0};
 const ids=candidates.map(p=>p.yahooId);
 const {known,catalog,historyThrough}=await withScopedTransaction(async c=>{
  const historyThrough=(await c.query("select max(game_day)::text as latest from sc3.sc3_nba_sync_days where status='complete' and game_day<$1::date",[leagueToday(now)])).rows[0]?.latest??null;
  const known=(await c.query("select yahoo_id,espn_id from sc3.sc3_player_identity where status='verified' and yahoo_id=any($1::text[])",[ids])).rows;
  const catalog=known.length===ids.length?[]:(await c.query(`
    select e.espn_id as "espnId",e.name,e.nba_team as team,e.birth_date::text as "birthDate"
    from sc3.espn_player_identity e where e.birth_date is not null and not exists
    (select 1 from sc3.sc3_player_identity i where i.espn_id=e.espn_id and i.status='verified')
  `)).rows;
  return {known,catalog,historyThrough};
 });
 const yesterday=new Date(Date.parse(leagueToday(now)+'T12:00:00Z')-86400_000).toISOString().slice(0,10);
 if(!historyThrough||historyThrough<yesterday)return {...waiverPlan,impactStatus:'Latest NBA history has not synced',impactCoverage:0};
 const linked=catalog.length?await verifyMissingYahooPlayers(candidates.filter(row=>!known.some(k=>k.yahoo_id===row.yahooId)),catalog,fetcher):[];
 const pairs=[...known,...linked.map(row=>({yahoo_id:row.yahooId,espn_id:row.espnId}))];
 const logs=pairs.length?await withScopedTransaction(async c=>(await c.query(`
  select i.yahoo_id,g.stats from jsonb_to_recordset($1::jsonb) as i(yahoo_id text,espn_id text)
  cross join lateral (
   select l.stats from sc3.sc3_nba_game_logs l join sc3.sc3_nba_sync_days d using(game_day)
   where l.espn_id=i.espn_id and l.game_day<=$2::date and d.status='complete'
   order by l.game_day desc,l.tipoff desc,l.event_id desc limit 10
  ) g`,[JSON.stringify(pairs),historyThrough])).rows):[];
 const rows=applyWaiverImpact(waiverPlan.rows,logs,baseline);
 return {...waiverPlan,rows,impactCoverage:rows.filter(row=>row.impact).length,impactChecked:candidates.length,
  historyThrough,impactObservedAt:baseline.observedAt};
}
