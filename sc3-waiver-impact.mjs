import {NINE_CAT} from './decision-core.mjs';
import {readYahooPageBaseline,verifyMissingYahooPlayers} from './sc3-projection-sources.mjs';
import {leagueToday} from './yahoo-scoreboard.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
import {teamCode} from './sc3-depth-store.mjs';
import {missingHistoryCatalog,recoverHistoryCatalog} from './sc3-catalog-recovery.mjs';

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

const normalizedName=name=>String(name??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function planWaiverIdentityChecks(candidates,known,catalog,{limit=60,occupied=[],missingSeeds=[]}={}){
 const knownIds=new Set(known.map(p=>String(p.yahoo_id)));
 const pending=[],reasons=new Map();
 const blocked=new Set(occupied.map(p=>String(p.espn_id)));
 const seedKeys=new Set(missingSeeds.map(p=>normalizedName(p.name)+'|'+teamCode(p.team)));
 const allNames=new Set(catalog.map(p=>normalizedName(p.name)));
 const byName=new Map();
 for(const p of catalog){
  const key=normalizedName(p.name)+'|'+teamCode(p.team);
  if(!byName.has(key))byName.set(key,[]);
  byName.get(key).push(p);
 }
 for(const p of candidates){
  if(knownIds.has(String(p.yahooId)))continue;
  const exact=byName.get(normalizedName(p.name)+'|'+teamCode(p.nbaTeam))??[];
  if(exact.length!==1){reasons.set(p.yahooId,exact.length?'AMBIGUOUS_CATALOG':seedKeys.has(normalizedName(p.name)+'|'+teamCode(p.nbaTeam))?'HISTORY_PROFILE_UNVERIFIED':allNames.has(normalizedName(p.name))?'CATALOG_TEAM_MISMATCH':'NO_CATALOG_MATCH');continue;}
  if(blocked.has(String(exact[0].espnId))){reasons.set(p.yahooId,'ESPN_ID_LINKED_TO_OTHER_YAHOO');continue;}
  if(exact[0].active===false){reasons.set(p.yahooId,'NBA_PROFILE_INACTIVE');continue;}
  if(Number(exact[0].games)<3){reasons.set(p.yahooId,'CATALOG_SAMPLE_LT_3');continue;}
  pending.push(p);
 }
 pending.sort((a,b)=>b.extraStarts-a.extraStarts||a.name.localeCompare(b.name)||String(a.yahooId).localeCompare(String(b.yahooId)));
 const checked=pending.slice(0,limit);
 for(const p of pending.slice(limit))reasons.set(p.yahooId,'VERIFICATION_BUDGET');
 return {checked,reasons};
}
export function waiverImpactCoverage(candidates,rows,pairs,logs,precheck){
 const linked=new Set(pairs.map(p=>String(p.yahoo_id))),sampleCounts=new Map();
 for(const p of logs)sampleCounts.set(String(p.yahoo_id),(sampleCounts.get(String(p.yahoo_id))??0)+1);
 const result=new Map(rows.map(r=>[r.yahooId,r]));
 const reasons={},unresolved=[];
 for(const p of candidates){
  let reason;
  if(result.get(p.yahooId)?.impact)reason='READY';
  else if(precheck.reasons.has(p.yahooId))reason=precheck.reasons.get(p.yahooId);
  else if(!linked.has(String(p.yahooId)))reason='IDENTITY_UNVERIFIED';
  else if((sampleCounts.get(String(p.yahooId))??0)<3)reason='SAMPLE_LT_3';
  else reason='INVALID_STAT_SAMPLE_OR_BASELINE';
  reasons[reason]=(reasons[reason]??0)+1;
  if(reason!=='READY')unresolved.push({yahooId:p.yahooId,name:p.name,nbaTeam:p.nbaTeam,reason});
 }
 return {attempted:precheck.checked.length,linked:linked.size,reasons,unresolved};
}
export async function enrichWaiverImpact(waiverPlan,matchup,{now,fetcher=fetch}){
 const candidates=waiverPlan.rows.filter(row=>row.extraStarts>0&&row.nbaTeam);
 if(!candidates.length)return {...waiverPlan,impactStatus:'No candidates with extra starts to evaluate',impactCoverage:0};
 const baseline=await readYahooPageBaseline(matchup,now,fetcher).catch(()=>null);
 if(!baseline)return {...waiverPlan,impactStatus:'Current Yahoo matchup baseline unavailable',impactCoverage:0};
 const ids=candidates.map(p=>p.yahooId);
 const {known,catalog,historyThrough,occupied,missingSeeds}=await withScopedTransaction(async c=>{
  const historyThrough=(await c.query("select max(game_day)::text as latest from sc3.sc3_nba_sync_days where status='complete' and game_day<$1::date",[leagueToday(now)])).rows[0]?.latest??null;
  const allLinks=(await c.query("select yahoo_id,espn_id from sc3.sc3_player_identity where status='verified'")).rows;
  const known=allLinks.filter(r=>ids.includes(r.yahoo_id));
  const occupied=allLinks.filter(r=>!ids.includes(r.yahoo_id));
  const catalog=known.length===ids.length?[]:(await c.query(`
    select e.espn_id as "espnId",e.name,e.nba_team as team,e.birth_date::text as "birthDate",
     (select count(*)::int from sc3.sc3_nba_game_logs g join sc3.sc3_nba_sync_days d using(game_day)
       where g.espn_id=e.espn_id and d.status='complete' and g.game_day<=$1::date) as games
    from sc3.espn_player_identity e where e.birth_date is not null
  `,[historyThrough])).rows;
  const missingSeeds=await missingHistoryCatalog(c,historyThrough);
  return {known,catalog,historyThrough,occupied,missingSeeds};
 });
 const yesterday=new Date(Date.parse(leagueToday(now)+'T12:00:00Z')-86400_000).toISOString().slice(0,10);
 if(!historyThrough||historyThrough<yesterday)return {...waiverPlan,impactStatus:'Latest NBA history has not synced',impactCoverage:0};
 const recovery=await recoverHistoryCatalog(candidates,missingSeeds,fetcher);
 const expanded=[...catalog,...recovery.profiles];
 const precheck=planWaiverIdentityChecks(candidates,known,expanded,{occupied:[...occupied,...known],missingSeeds});
 const occupiedIds=new Set([...known,...occupied].map(p=>String(p.espn_id)));
 const linked=precheck.checked.length?(await verifyMissingYahooPlayers(precheck.checked,expanded,fetcher)).filter(p=>!occupiedIds.has(String(p.espnId))):[];
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
  impactDiagnostics:{...waiverImpactCoverage(candidates,rows,pairs,logs,precheck),catalogRecovery:{attempted:recovery.attempted,recovered:recovery.profiles.length,missingHistoryIds:missingSeeds.length}},historyThrough,impactObservedAt:baseline.observedAt,displayImpactCoverage:rows.slice(0,25).filter(row=>row.impact).length};
}
