import {createHash} from 'node:crypto';
import {runP21Cycle} from './sc3-p21-cycle.mjs';
import {appendMatchup,appendMatchupSettlements} from './sc3-matchup-ledger.mjs';
import {appendCBSSettlements} from './sc3-cbs-settlement.mjs';
import {archiveFinalMatchups,readVerifiedFinalArchive} from './sc3-final-archive.mjs';
import {officialPublication} from './sc3-nba-official-injuries.mjs';
export async function appendOfficialObservations(feed,{writerTransaction}={}){
 if(typeof writerTransaction!=='function')throw Error('Dedicated writer required');
 if(feed?.source!=='NBA_OFFICIAL'||!Array.isArray(feed.rows)||officialPublication(feed.url)!==feed.publishedAt||!/^[a-f0-9]{64}$/.test(feed.documentDigest??''))return {inserted:0,reason:'Invalid official report'};
 return writerTransaction(async c=>{
  const now=(await c.query('select clock_timestamp() now')).rows[0].now;
  if(!Number.isFinite(Date.parse(feed.observedAt))||Date.parse(feed.observedAt)>+now||+now-Date.parse(feed.observedAt)>300000)throw Error('Stale official observation');
  let inserted=0;
  for(const row of feed.rows){
   if(row.source!=='NBA_OFFICIAL'||row.sourceUrl!==feed.url||row.publishedAt!==feed.publishedAt||row.observedAt!==feed.observedAt||row.kind!=='GAME_STATUS_NOT_RETURN_ESTIMATE')throw Error('Mismatched official row provenance');
   const id=createHash('sha256').update(JSON.stringify([feed.documentDigest,row.espnId,row.gameDate,row.status])).digest('hex');
   const r=await c.query('insert into sc3.p2_official_injury_observations(id,espn_id,game_date,published_at,observed_at,document_digest,source_url,status,payload) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) on conflict do nothing returning id',[id,row.espnId,row.gameDate,row.publishedAt,row.observedAt,feed.documentDigest,feed.url,row.status,JSON.stringify(row)]);
   inserted+=r.rowCount;
  }
  return {inserted,attempted:feed.rows.length};
 });
}
export async function runP22Cycle({writerTransaction,collectESPN,collectCBS,collectOfficial,collectMatchup,loadTargets,readWeek}={}){
 if([writerTransaction,collectESPN,collectCBS,collectOfficial,collectMatchup,loadTargets,readWeek].some(f=>typeof f!=='function'))throw Error('Explicit dedicated writer and collectors required');
 // First observe current inputs in parallel, then archive closed fixtures.
 const [official,matchup,targets]=await Promise.allSettled([collectOfficial(),collectMatchup(),loadTargets()]);
 const results={};
 async function stage(key,fn){try{results[key]={status:'COMPLETE',...await fn()};}catch{results[key]={status:'FAILED'};}}
 if(official.status==='fulfilled'&&official.value)await stage('nbaOfficial',()=>appendOfficialObservations(official.value,{writerTransaction}));else results.nbaOfficial={status:'UNAVAILABLE'};
 if(targets.status==='fulfilled'){
  await stage('finalArchive',async()=>{
   const pending=await writerTransaction(async c=>(await c.query("select distinct league_id as \"leagueId\",week,opponent_id as \"opponentId\",week_start::text as \"weekStart\",week_end::text as \"weekEnd\" from sc3.p2_matchup_forecasts where week_end<(clock_timestamp() at time zone 'America/Los_Angeles')::date")).rows);
   return archiveFinalMatchups([...targets.value,...pending],{writerTransaction,readWeek});
  });
 }else results.finalArchive={status:'UNAVAILABLE'};
 const base=await runP21Cycle({writerTransaction,collectESPN,collectCBS,collectMatchup:async()=>matchup.status==='fulfilled'?matchup.value:null,readFinal:readVerifiedFinalArchive});
 Object.assign(results,base);
 await stage('modelAlternatives',async()=>{
  if(matchup.status!=='fulfilled'||!matchup.value?.projection?.alternativeForecasts?.length)return {inserted:0,reason:'Verified alternatives unavailable'};
  let inserted=0;const records=[];
  for(const f of matchup.value.projection.alternativeForecasts){const r=await appendMatchup(matchup.value,f,{writerTransaction});inserted+=r.inserted;records.push({model:f.model,inserted:r.inserted,reason:r.reason});}
  return {inserted,records};
 });
 await stage('cbsSettlement',()=>appendCBSSettlements({writerTransaction}));
 return results;
}
