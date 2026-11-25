import test from 'node:test';
import assert from 'node:assert/strict';
import {compareModels,estimate,modelWeights,MODELS} from './sc3-model-comparison.mjs';
import {parseCBSInjuries} from './sc3-cbs-injuries.mjs';
import {matchupRecord,settleMatchup} from './sc3-matchup-ledger.mjs';
import {runP21Cycle} from './sc3-p21-cycle.mjs';
import {NINE_CAT,categoryComparison} from './decision-core.mjs';
const box={PTS:11,REB:4,AST:3,STL:1,BLK:1,TO:1,FGM:4,FGA:8,FTM:2,FTA:2,'3PM':1,MIN:25};
const stamp=d=>'2026-11-'+String(d).padStart(2,'0')+'T02:00:00Z';
const logs=Array.from({length:20},(_,i)=>({espn_id:'1',event_id:String(i+1),tipoff:stamp(i+1),observed_at:stamp(i+1).replace('02:','08:'),stats:{...box,PTS:i+1,REB:2+i%5,AST:1+i%4,STL:i%3,BLK:i%2,TO:i%4,FGM:3+i%3,FGA:8,FTM:1+i%2,FTA:2,'3PM':i%3}}));
test('all seven models use normalized weights; shooting estimates pool attempts and omit zero attempts',()=>{
 for(const m of MODELS)assert.ok(Math.abs(modelWeights(20,m).reduce((a,b)=>a+b,0)-1)<1e-12);
 assert.equal(modelWeights(20,'L3').filter(Boolean).length,3);
 assert.equal(modelWeights(20,'L14').filter(Boolean).length,14);
 assert.ok(modelWeights(20,'EWMA').at(-1)>modelWeights(20,'EWMA')[0]);
 assert.equal(estimate([{...box,FGM:1,FGA:2},{...box,FGM:9,FGA:10}],[.5,.5],'FG%'),10/12);
 assert.equal(estimate([{...box,FTM:0,FTA:0}],[1],'FT%'),null);
});
test('chronological test outcomes cannot change frozen validation model; nine categories share comparison support',()=>{
 const a=compareModels(logs,{asOf:'2026-11-24T00:00:00Z'});assert.equal(a.available,true);assert.equal(a.ranking.length,7);assert.equal(a.counts.training,10);assert.equal(a.counts.validation,5);assert.equal(a.counts.test,5);
 const changed=logs.map((r,i)=>i>=15?{...r,stats:{...r.stats,PTS:999}}:r);
 const b=compareModels(changed,{asOf:'2026-11-24T00:00:00Z'});
 assert.equal(a.selected,b.selected);assert.deepEqual(a.validation,b.validation);assert.notDeepEqual(a.test,b.test);
 for(const k of NINE_CAT)assert.equal(a.test.L3[k].n,a.test.SEASON[k].n);
});
test('unobserved validation outcome cannot leak into model selection',()=>{
 const late=logs.map((r,i)=>i===14?{...r,observed_at:'2026-11-20T09:00:00Z'}:r);
 const a=compareModels(late,{asOf:'2026-11-24T00:00:00Z'});
 assert.equal(a.counts.validation,4);assert.equal(a.counts.skipped,1);
});
test('CBS parses real-shaped team tables, lower bound and year rollover; no invented exact return',()=>{
 const teams=['ATL','BOS','BKN','CHA','CHI','CLE','DAL','DEN','GS','SA'];
 const names=teams.flatMap((team,i)=>Array.from({length:3},(_,j)=>({name:'Player '+i+' '+j,team,espnId:String(i*3+j+1)})));
 const html='<h1 class="PageNarrow-title">NBA Injuries</h1>'+teams.map((team,i)=>'<h4 class="TableBase-title large"><a href="/nba/teams/'+team+'/club/">Club</a></h4><table>'+names.filter(n=>n.team===team).map(n=>'<tr class="TableBase-bodyTr"><td><span class="CellPlayerName--long"><a href="/nba/players/1/player/">'+n.name+'</a></span></td><td>PG</td><td><span>Mon, Nov 23</span></td><td>Knee</td><td>Expected to be out until at least Jan 2</td></tr>').join('')+'</table>').join('');
 const r=parseCBSInjuries(html,names,new Date('2026-11-24T20:00:00Z'));
 assert.equal(r.rows.length,30);assert.equal(r.rows[0].earliestReturn,'2027-01-02');assert.equal(r.rows[0].kind,'LOWER_BOUND_NOT_POINT_ESTIMATE');
 assert.equal(parseCBSInjuries(html,[...names,{...names[0],espnId:'999'}],new Date('2026-11-24T20:00:00Z')).rows.length,29);
 assert.throws(()=>parseCBSInjuries('<h1>NBA Injuries</h1>',names),/coverage/);
});
const report={complete:true,week:6,weekStart:'2026-11-23',weekEnd:'2026-11-29',teams:[{id:5},{id:2}]};
const p={win:.4,tie:.1,loss:.5};
const f={available:true,conditional:true,calibrated:false,modelVersion:'fixture',asOf:'2026-11-24T20:00:00Z',baselineObservedAt:'2026-11-24T19:59:00Z',historyThrough:'2026-11-23',inputsDigest:'a'.repeat(64),scenarios:[{matchup:p,categories:NINE_CAT.map(category=>({category,...p}))}],simulations:100,seed:1,coverage:{}};
test('matchup ledger binds model and data digest, refuses future or incomplete observations and nonfinal results',()=>{
 const row=matchupRecord(report,f,f.asOf);assert.ok(row.id);assert.equal(row.modelVersion,'fixture');
 assert.notEqual(matchupRecord(report,{...f,inputsDigest:'b'.repeat(64)},f.asOf).id,row.id);
 assert.equal(matchupRecord(report,{...f,asOf:'2026-11-25T00:00Z'},f.asOf),null);
 assert.equal(matchupRecord(report,{...f,inputsDigest:null},f.asOf),null);
 const stats={...box,'FG%':.5,'FT%':1};const official={...row,source:'Yahoo Fantasy Sports API',finalVerified:true,ourTeam:{id:5,stats},opponent:{id:2,stats},score:categoryComparison(stats,stats).score,observedAt:'2026-11-30T12:00Z'};
 assert.equal(settleMatchup(row,official,'2026-11-30T13:00Z').matchup,'tie');
 assert.equal(settleMatchup(row,{...official,finalVerified:false},'2026-11-30T13:00Z'),null);
 assert.equal(settleMatchup(row,{...official,opponent:{id:3,stats}},'2026-11-30T13:00Z'),null);
});
test('collection cycle refuses implicit shared database or missing collectors',async()=>{
 await assert.rejects(runP21Cycle(),/Dedicated/);
 await assert.rejects(runP21Cycle({writerTransaction:async()=>{}}),/collectors/);
});

test('coverage-based chronology uses only observation timing and preserves chronological separation',()=>{
 const backfilled=logs.map((r,i)=>i<12?{...r,observed_at:'2026-11-13T00:00:00Z'}:r);
 const a=compareModels(backfilled,{asOf:'2026-11-24T00:00:00Z',split:'observation-coverage'});
 assert.equal(a.validationStart,'2026-11-13');assert.equal(a.testStart,'2026-11-17');
 assert.ok(a.counts.validation>0&&a.counts.test>0);
 const changed=backfilled.map((r,i)=>i>=16?{...r,stats:{...r.stats,PTS:1000}}:r);
 const b=compareModels(changed,{asOf:'2026-11-24T00:00:00Z',split:'observation-coverage'});
 assert.equal(a.selected,b.selected);assert.deepEqual(a.validation,b.validation);
});
