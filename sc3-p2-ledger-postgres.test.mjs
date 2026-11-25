import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runP22Cycle} from './sc3-p22-cycle.mjs';
import {archiveFinalMatchups} from './sc3-final-archive.mjs';
import {readCBSBoundMetrics} from './sc3-cbs-settlement.mjs';
import {officialPublication} from './sc3-nba-official-injuries.mjs';
import {runP21Cycle} from './sc3-p21-cycle.mjs';
import {NINE_CAT} from './decision-core.mjs';
import {YAHOO_STAT_IDS} from './yahoo-scoreboard.mjs';
import {matchupRecord} from './sc3-matchup-ledger.mjs';
import {appendObservedForecasts,appendVerifiedSettlements,readReturnLedger} from './sc3-return-store.mjs';
const ci=process.env.CI==='true'&&process.env.GITHUB_ACTIONS==='true';
test('P2 ledger uses real disposable PostgreSQL; server timestamps and append-only privileges cannot be bypassed', {skip:!ci}, async()=>{
 // Never use SC3 production connection strings. This fixed local fixture is the
 // existing disposable GitHub Actions PostgreSQL 17 service.
 const {Client}=await import('pg');
 const c=new Client({host:'127.0.0.1',port:5432,database:'sc3_refresh_test',user:'postgres',password:'fixture-ci-only',connectionTimeoutMillis:5000});
 const schema='sc3_p2_ci',writer='sc3_p2_ci_writer',reader='sc3_p2_ci_reader';
 const mapSQL=sql=>sql.replaceAll('sc3.','sc3_p2_ci.');
 const local={query:(sql,args)=>c.query(mapSQL(sql),args)};
 const tx=role=>async fn=>{
  await c.query('begin');
  try{await c.query('set local role '+role);const r=await fn(local);await c.query('commit');return r;}
  catch(e){await c.query('rollback');throw e;}
 };
 await c.connect();
 try{
  await c.query('create schema '+schema);
  for(const role of [reader,'p2_ci_anon','p2_ci_authenticated'])await c.query('create role '+role+' nologin');
  await c.query('grant usage on schema '+schema+' to '+reader);
  await c.query(`create table ${schema}.sc3_nba_sync_days(game_day date primary key,observed_at timestamptz,player_rows integer,completed_events integer,status text);
   create table ${schema}.sc3_nba_game_logs(event_id text,espn_id text,game_day date,tipoff timestamptz,observed_at timestamptz,stats jsonb);
   create table ${schema}.yahoo_league_snapshot_history(league_id integer,section text,observed_at timestamptz,payload jsonb)`);
  let migration=await readFile(new URL('./migrations/sc3-p2-return-ledger.sql',import.meta.url),'utf8');
  migration=migration.replace(/\bsc3\b/g,schema).replace(/\bsc3_app\b/g,reader).replace(/\bsc3_p2_writer\b/g,writer).replace(/\banon\b/g,'p2_ci_anon').replace(/\bauthenticated\b/g,'p2_ci_authenticated');
  await c.query(migration);
  let p21=await readFile(new URL('./migrations/sc3-p21-matchup-ledger.sql',import.meta.url),'utf8');
  p21=p21.replace(/\bsc3\b/g,schema).replace(/\bsc3_app\b/g,reader).replace(/\bsc3_p2_writer\b/g,writer).replace(/\banon\b/g,'p2_ci_anon').replace(/\bauthenticated\b/g,'p2_ci_authenticated');
  await c.query(p21);
  let p22=await readFile(new URL('./migrations/sc3-p22-evidence-ledger.sql',import.meta.url),'utf8');
  p22=p22.replace(/\bsc3\b/g,schema).replace(/\bsc3_app\b/g,reader).replace(/\bsc3_p2_writer\b/g,writer).replace(/\banon\b/g,'p2_ci_anon').replace(/\bauthenticated\b/g,'p2_ci_authenticated');
  await c.query(p22);
  const now=(await c.query('select clock_timestamp() now')).rows[0].now;
  const instant=new Date(now-2000).toISOString();
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const feed={observedAt:instant,rows:new Map([['10',{espnId:'10',reportAt:instant,reportedReturnDate:day,status:'Out'}]])};
  const first=await appendObservedForecasts(feed,{writerTransaction:tx(writer)});
  assert.equal(first.inserted,1);
  const second=await appendObservedForecasts(feed,{writerTransaction:tx(writer)});
  assert.equal(second.inserted,0);
  const forecast=(await c.query('select * from '+schema+'.p2_return_forecasts')).rows[0];
  assert.ok(forecast.captured_at>new Date(instant));
  const r=await readReturnLedger({transaction:tx(reader),now:new Date()});
  assert.equal(r.status,'READY');assert.equal(r.recorded,1);assert.equal(r.settled,0);assert.equal(r.sources[0].reliability,null);
  for(const sql of [
   'update sc3.p2_return_forecasts set estimated_date=estimated_date',
   'delete from sc3.p2_return_forecasts',
   'truncate sc3.p2_return_forecasts cascade',
   "insert into sc3.p2_return_forecasts(id,captured_at) values(repeat('a',64),clock_timestamp())"
  ])await assert.rejects(tx(writer)(c=>c.query(sql)),/permission denied/);
  await assert.rejects(tx(reader)(c=>c.query('delete from sc3.p2_return_forecasts')),/permission denied/);
  await assert.rejects(c.query('update '+schema+'.p2_return_forecasts set estimated_date=estimated_date'),/append-only/);
  // Fixture outcome is written to the disposable history only, after capture.
  const evidence=(await c.query("select clock_timestamp() as t")).rows[0].t;
  assert.ok(evidence>=forecast.captured_at);
  await c.query(`insert into ${schema}.sc3_nba_game_logs values('777','10',$1,$2,$2,'{"MIN":20}'::jsonb)`,[day,evidence]);
  await c.query(`insert into ${schema}.sc3_nba_sync_days values($1,$2,1,1,'complete')`,[day,evidence]);
  await assert.rejects(tx(writer)(c=>c.query("insert into sc3.p2_return_settlements(forecast_id,event_id,actual_date,actual_tipoff,evidence_observed_at) values($1,'999',$2,$3,$3)",[forecast.id,day,evidence])),/does not match/);
  const settled=await appendVerifiedSettlements({writerTransaction:tx(writer)});
  assert.equal(settled.inserted,1);
  // PostgreSQL captures microseconds, whereas JavaScript Date truncates to ms.
  // Choose an actual DB observation after commit, not a future synthetic cutoff.
  await c.query('select pg_sleep(0.01)');
  const readAt=(await c.query('select clock_timestamp() as now')).rows[0].now;
  const final=await readReturnLedger({transaction:tx(reader),now:readAt});
  assert.equal(final.settled,1);assert.equal(final.sources[0].maeDays,0);assert.equal(final.sources[0].reliability,null);
  await assert.rejects(tx(writer)(c=>c.query('delete from sc3.p2_return_settlements')),/permission denied/);
  await assert.rejects(c.query('delete from '+schema+'.p2_return_settlements'),/append-only/);
  // Entire automatic collection/settlement cycle, local CI fixtures only.
  const current=(await c.query('select clock_timestamp() now')).rows[0].now;
  const pacific=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(current);
  const date=new Date(pacific+'T12:00:00Z');
  const offset=(date.getUTCDay()+6)%7;
  const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  const weekStart=shift(pacific,-offset),weekEnd=shift(weekStart,6);
  const prob={win:.3,tie:.2,loss:.5};
  const forecastData={available:true,conditional:true,calibrated:false,modelVersion:'ci-fixture',asOf:current.toISOString(),baselineObservedAt:current.toISOString(),historyThrough:shift(pacific,-1),inputsDigest:'a'.repeat(64),simulations:100,seed:1,coverage:{},scenarios:[{matchup:prob,categories:NINE_CAT.map(category=>({category,...prob}))}]};
  const report={complete:true,week:6,weekStart,weekEnd,teams:[{id:5},{id:2}],projection:{forecast:forecastData}};
  const cbs={source:'CBS',observedAt:current.toISOString(),rows:[{source:'CBS',sourceUrl:'https://www.cbssports.com/nba/injuries/',espnId:'10',name:'Fixture',reportDate:day,earliestReturn:day,observedAt:current.toISOString(),status:'Expected to be out until at least today',kind:'LOWER_BOUND_NOT_POINT_ESTIMATE'}]};
  const opts={writerTransaction:tx(writer),collectESPN:async()=>feed,collectCBS:async()=>cbs,collectMatchup:async()=>report};
  const cycle=await runP21Cycle(opts);
  assert.equal(cycle.espn.inserted,0);assert.equal(cycle.cbs.inserted,1);assert.equal(cycle.matchup.inserted,1);assert.equal(cycle.matchupSettlement.inserted,0);
  const repeated=await runP21Cycle(opts);
  assert.equal(repeated.cbs.inserted,0);assert.equal(repeated.matchup.inserted,0);
  // Explicit historical fixture (not a claim of a real forecast): use schema owner
  // to seed one prior week in the disposable database.
  const pastStart=shift(weekStart,-7),pastEnd=shift(weekEnd,-7);
  const pastAsOf=pastStart+'T20:00:00Z';
  const oldReport={...report,week:5,weekStart:pastStart,weekEnd:pastEnd};
  const old=matchupRecord(oldReport,{...forecastData,asOf:pastAsOf,baselineObservedAt:pastAsOf,historyThrough:shift(pastStart,-1)},pastAsOf);
  await c.query('insert into '+schema+'.p2_matchup_forecasts(id,league_id,week,opponent_id,week_start,week_end,model_version,forecast_as_of,baseline_observed_at,history_through,inputs_digest,payload) values($1,85892,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[old.id,old.week,old.opponentId,old.weekStart,old.weekEnd,old.modelVersion,old.asOf,old.baselineObservedAt,old.historyThrough,old.inputsDigest,JSON.stringify(old)]);
  const key=id=>'478.l.85892.t.'+id;
  const team=id=>({team:[[{team_key:key(id)},{name:'Fixture'}],{team_stats:{stats:Object.entries(YAHOO_STAT_IDS).map(([cat,stat_id])=>({stat:{stat_id,value:cat.includes('%')?'0.5':'1'}}))},team_points:{total:'0'}}]});
  const finalPayload={league:[{league_key:'478.l.85892'}, {scoreboard:{0:{matchups:{0:{matchup:{status:'postevent',week:'5',week_start:pastStart,week_end:pastEnd,'0':{teams:{0:team(5),1:team(2)}},stat_winners:Object.values(YAHOO_STAT_IDS).map(stat_id=>({stat_winner:{stat_id}}))}}}}}}]};
  await c.query('insert into '+schema+'.yahoo_league_snapshot_history values(85892,\'scoreboard\',$1,$2)',[current,JSON.stringify(finalPayload)]);
  const archived=await archiveFinalMatchups([old],{writerTransaction:tx(writer),readWeek:async path=>{assert.match(path,/scoreboard;week=5\?format=json$/);return finalPayload;}});
  assert.equal(archived.inserted,1);
  assert.equal((await archiveFinalMatchups([old],{writerTransaction:tx(writer),readWeek:async()=>{throw Error('duplicate should not read');}})).inserted,0);
  const finalCycle=await runP21Cycle(opts);
  assert.equal(finalCycle.matchupSettlement.inserted,1);
  const finalRow=(await c.query('select outcome from '+schema+'.p2_matchup_settlements where forecast_id=$1',[old.id])).rows[0];
  assert.equal(finalRow.outcome.matchup,'tie');assert.equal(finalRow.outcome.score.ties,9);
  await assert.rejects(tx(writer)(c=>c.query('update sc3.p2_matchup_forecasts set model_version=model_version')),/permission denied/);
  await assert.rejects(c.query('delete from '+schema+'.p2_matchup_settlements'),/append-only/);
  await assert.rejects(tx(writer)(c=>c.query('truncate sc3.p2_cbs_observations')),/permission denied/);
  // P2.2: an explicit lower bound on athlete 11, captured before the test appearance.
  const stamp=(await c.query('select clock_timestamp() now')).rows[0].now.toISOString();
  const bound={...cbs,observedAt:stamp,rows:[{...cbs.rows[0],espnId:'11',observedAt:stamp,earliestReturn:shift(day,1)}]};
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:true}).formatToParts(new Date(stamp)).map(p=>[p.type,p.value]));
  const url='https://ak-static.cms.nba.com/referee/injury/Injury-Report_'+parts.year+'-'+parts.month+'-'+parts.day+'_'+parts.hour+'_'+parts.minute+parts.dayPeriod+'.pdf';
  const publishedAt=officialPublication(url);
  const official={source:'NBA_OFFICIAL',url,publishedAt,observedAt:stamp,documentDigest:'b'.repeat(64),rows:[{espnId:'11',name:'Fixture',nbaTeam:'SAC',gameDate:day,status:'Out',source:'NBA_OFFICIAL',sourceUrl:url,publishedAt,observedAt:stamp,kind:'GAME_STATUS_NOT_RETURN_ESTIMATE'}]};
  const alt={...forecastData,model:'EWMA',modelVersion:'ci-fixture:EWMA',asOf:stamp,baselineObservedAt:stamp,inputsDigest:'c'.repeat(64)};
  const p22opts={...opts,collectOfficial:async()=>official,collectCBS:async()=>bound,collectMatchup:async()=>({...report,projection:{forecast:forecastData,alternativeForecasts:[alt]}}),loadTargets:async()=>[old],readWeek:async()=>{throw Error('already archived');}};
  const p22first=await runP22Cycle(p22opts);assert.equal(p22first.nbaOfficial.inserted,1);assert.equal(p22first.cbs.inserted,1);assert.equal(p22first.modelAlternatives.inserted,1);assert.equal(p22first.cbsSettlement.inserted,0);
  await c.query('select pg_sleep(0.02)');
  const after=(await c.query('select clock_timestamp() now')).rows[0].now;
  await c.query(`insert into ${schema}.sc3_nba_game_logs values('778','11',$1,$2,$2,'{"MIN":20}'::jsonb)`,[day,after]);
  await c.query(`update ${schema}.sc3_nba_sync_days set player_rows=2,completed_events=2,observed_at=$1 where game_day=$2`,[after,day]);
  await c.query('select pg_sleep(0.02)');
  const p22second=await runP22Cycle(p22opts);assert.equal(p22second.nbaOfficial.inserted,0);assert.equal(p22second.cbs.inserted,0);assert.equal(p22second.modelAlternatives.inserted,0);assert.equal(p22second.cbsSettlement.inserted,1);
  await c.query('select pg_sleep(0.01)');
  const metrics=await readCBSBoundMetrics({transaction:tx(reader),now:(await c.query('select clock_timestamp() now')).rows[0].now});
  assert.equal(metrics.independentReturnEvents,1);assert.equal(metrics.violations,1);assert.equal(metrics.meanDaysEarly,1);assert.equal(metrics.boundAdherenceLower95,null);
  await assert.rejects(tx(writer)(c=>c.query('delete from sc3.p2_cbs_settlements')),/permission denied/);
  await assert.rejects(tx(writer)(c=>c.query('select * from sc3.yahoo_league_snapshot_history')),/permission denied/);


 }finally{
  try{await c.query('rollback')}catch{}
  await c.query('drop schema if exists '+schema+' cascade');
  for(const role of [writer,reader,'p2_ci_anon','p2_ci_authenticated'])await c.query('drop role if exists '+role);
  await c.end();
 }
});
