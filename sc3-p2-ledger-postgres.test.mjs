import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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
   create table ${schema}.sc3_nba_game_logs(event_id text,espn_id text,game_day date,tipoff timestamptz,observed_at timestamptz,stats jsonb)`);
  let migration=await readFile(new URL('./migrations/sc3-p2-return-ledger.sql',import.meta.url),'utf8');
  migration=migration.replace(/\bsc3\b/g,schema).replace(/\bsc3_app\b/g,reader).replace(/\bsc3_p2_writer\b/g,writer).replace(/\banon\b/g,'p2_ci_anon').replace(/\bauthenticated\b/g,'p2_ci_authenticated');
  await c.query(migration);
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
  const final=await readReturnLedger({transaction:tx(reader),now:new Date()});
  assert.equal(final.settled,1);assert.equal(final.sources[0].maeDays,0);assert.equal(final.sources[0].reliability,null);
  await assert.rejects(tx(writer)(c=>c.query('delete from sc3.p2_return_settlements')),/permission denied/);
  await assert.rejects(c.query('delete from '+schema+'.p2_return_settlements'),/append-only/);
 }finally{
  try{await c.query('rollback')}catch{}
  await c.query('drop schema if exists '+schema+' cascade');
  for(const role of [writer,reader,'p2_ci_anon','p2_ci_authenticated'])await c.query('drop role if exists '+role);
  await c.end();
 }
});
