import test from 'node:test';
import assert from 'node:assert/strict';
import {historyRefreshPlan,readHistoryPlan,nbaHistoryCron,verifyScoreboardObservation,saveScoreboardObservation,verifyScoreboardWrite,yahooScoreboardCron} from './sc3-freshness-sync.mjs';
const secret='fixture-cron-secret-at-least-32-characters';
const instant=new Date('2026-11-24T11:00:00Z');
const req={method:'GET',headers:{authorization:'Bearer '+secret}};
const env={VERCEL_ENV:'production',CRON_SECRET:secret,SC3_SHARED_DB:'1',SC3_NBA_HISTORY_CRON_ENABLED:'1',SC3_SCOREBOARD_CRON_ENABLED:'1'};
const res=()=>({setHeader(){},status(n){this.code=n;return this},json(x){this.body=x;return this}});
const fixture=()=>({league:[{league_key:'478.l.85892'},{scoreboard:{0:{matchups:{0:{matchup:{week:'6',week_start:'2026-11-23',week_end:'2026-11-29',0:{teams:Object.fromEntries([5,2].map((id,i)=>[i,{team:[[{team_key:'478.l.85892.t.'+id},{name:'Team '+id}],{team_stats:{stats:['5','8','10','12','15','16','17','18','19'].map(stat_id=>({stat:{stat_id,value:stat_id==='8'?null:stat_id==='5'?'.500':1}})).concat([{stat:{stat_id:'9007006',value:'0/0'}}])}}]}]))}}}}}}}]});
const plan=()=>historyRefreshPlan({start:'2026-11-21',end:'2026-11-23',completeDays:['2026-11-21','2026-11-22']});
const collect=async({dates})=>({complete:true,requestedDates:dates,observedAt:instant.toISOString(),completedEvents:0,rows:[]});
test('history freshness jobs prioritize recent gaps and retain remaining older gaps',()=>{
 const p=historyRefreshPlan({start:'2026-11-19',end:'2026-11-23',completeDays:['2026-11-20']});
 assert.deepEqual(p.targets,['2026-11-23','2026-11-22','2026-11-21']);assert.equal(p.remaining,1);
 assert.throws(()=>historyRefreshPlan({start:'2026-11-19',end:'2026-11-23',completeDays:[],limit:0}));
});
test('history plan repairs count-mismatched completed days and does not require production season env',async()=>{
 const p=await readHistoryPlan({now:instant,transaction:async fn=>fn({query:async()=>({rows:[{game_day:'2026-11-21',status:'complete',coverage_verified:true},{game_day:'2026-11-22',status:'complete',coverage_verified:false}]})})});
 assert.deepEqual(p.targets,['2026-11-23','2026-11-22']);
});
test('both scheduled jobs deny unauthorized and Preview invocations before reading sources',async()=>{
 for(const handler of [nbaHistoryCron,yahooScoreboardCron]){
  for(const [request,environment,code] of [[{method:'GET',headers:{}},env,401],[req,{...env,VERCEL_ENV:'preview'},404],[{...req,method:'POST'},env,405]]){
   const r=res();await handler(request,r,{env:environment,plan:()=>assert.fail('plan'),readScoreboard:()=>assert.fail('Yahoo read'),log:()=>{}});assert.equal(r.code,code);
  }
 }
});
test('NBA history dry-run validates missing day without writing; write mode verifies resulting coverage',async()=>{
 let r=res();await nbaHistoryCron(req,r,{env,now:instant,plan,collect,save:()=>assert.fail('write'),log:()=>{}});assert.equal(r.code,200);assert.equal(r.body.snapshotWrites,0);assert.equal(r.body.validated[0].day,'2026-11-23');
 let n=0,writes=0;r=res();await nbaHistoryCron(req,r,{env:{...env,SC3_NBA_HISTORY_CRON_WRITE:'1'},now:instant,plan:()=>++n===1?plan():{...plan(),missing:[]},collect,save:async()=>{writes++},log:()=>{}});assert.equal(r.code,200);assert.equal(writes,1);assert.equal(r.body.complete,true);
 r=res();await nbaHistoryCron(req,r,{env:{...env,SC3_NBA_HISTORY_CRON_WRITE:'1'},now:instant,plan,collect,save:async()=>{},log:()=>{}});assert.equal(r.code,503);assert.equal(r.body.complete,false);
});
test('scoreboard observation checks current week and exact league without guessing percentages',()=>{
 const raw=fixture(),at=instant.toISOString();
 assert.deepEqual(verifyScoreboardObservation(raw,at,instant),{week:6,opponentId:2,publishedCount:8,noAttemptCategories:['FT%']});
 raw.league[0].league_key='478.l.999';assert.throws(()=>verifyScoreboardObservation(raw,at,instant));
});
test('scoreboard dry-run never writes; confirmed write requires exact readback',async()=>{
 const raw=fixture();let r=res();await yahooScoreboardCron(req,r,{env,now:()=>instant,readScoreboard:async()=>raw,save:()=>assert.fail('write'),log:()=>{}});assert.equal(r.code,200);assert.equal(r.body.snapshotWrites,0);
 r=res();let saves=0,checks=0;await yahooScoreboardCron(req,r,{env:{...env,SC3_SCOREBOARD_CRON_WRITE:'1'},now:()=>instant,readScoreboard:async()=>raw,save:async()=>{saves++},verify:async()=>{checks++},log:()=>{}});assert.equal(r.code,200);assert.equal(saves,1);assert.equal(checks,1);
 r=res();await yahooScoreboardCron(req,r,{env:{...env,SC3_SCOREBOARD_CRON_WRITE:'1'},now:()=>instant,readScoreboard:async()=>raw,save:async()=>{},verify:async()=>{throw Error('private detail')},log:()=>{}});assert.equal(r.code,503);assert.equal(r.body.committed,true);assert.equal(r.body.category,'scoreboard_verify_failed');
});
test('scoreboard storage uses shared lock, monotonic timestamp and history; no other sections written',async()=>{
 const raw=fixture(),at=instant.toISOString(),queries=[];
 const transaction=async(fn,opts)=>{assert.equal(opts.readOnly,false);return fn({query:async(sql,args)=>{queries.push({sql,args});return {rows:[{snapshots:1,history:1}]}}})};
 await saveScoreboardObservation(raw,at,{transaction,now:instant});
 assert.match(queries[0].sql,/pg_advisory_xact_lock\(85892, 3\)/);
 assert.match(queries[1].sql,/'scoreboard'/);assert.match(queries[1].sql,/observed_at<excluded.observed_at/);assert.match(queries[1].sql,/snapshot_history/);
 await assert.rejects(verifyScoreboardWrite(raw,at,{transaction:async fn=>fn({query:async()=>({rows:[{verified:false}]})})}));
});
