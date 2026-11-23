import test from 'node:test';import assert from 'node:assert/strict';
import {statCatalog,playerStatRecords,loadPlayerStats} from './yahoo-player-stats.mjs';
import {parseBoxScore,gameWindows,performanceTrend,ingestGameLogs} from './nba-game-logs.mjs';
import {zScores} from './fantasy-zscore.mjs';
const catalog={stats:[{stat:{stat_id:5,name:'Field Goal Percentage',display_name:'FG%'}},{stat:{stat_id:12,name:'Points',display_name:'PTS'}},{stat:{stat_id:99,name:'Extra'}}]};
const response={players:{0:{player:[[{player_id:'42'}],{player_stats:{coverage_type:'average_season',stats:[{stat:{stat_id:5,value:'.500'}},{stat:{stat_id:12,value:'21.2'}},{stat:{stat_id:99,value:'4'}},{stat:{stat_id:100,value:'-'}}]}}]}}};
test('Yahoo all categories preserve unknown IDs and exact window',()=>{const x=playerStatRecords(response,statCatalog(catalog));assert.equal(x.get('42').values.PTS,21.2);assert.equal(x.get('42').values['FG%'],.5);assert.equal(x.get('42').rawStats.length,4);assert.equal(playerStatRecords(response,statCatalog(catalog),{coverage:'season'}).size,0)});
test('Yahoo player batches preserve requested IDs and upstream errors',async()=>{const r=await loadPlayerStats({gameKey:'478',playerIds:['42','43'],batchSize:1,read:async p=>p.includes('stat_categories')?catalog:p.includes('p.42')?response:Promise.reject(Object.assign(Error('unavailable'),{status:429}))});assert.equal(r.returned,1);assert.equal(r.errors[0].status,429)});
const event={id:'1',date:'2026-11-16T20:00:00Z',status:{type:{completed:true}}};
const summary={boxscore:{players:[{team:{abbreviation:'BOS'},statistics:[{labels:['MIN','PTS','FG','3PT','FT','REB','AST','TO','STL','BLK','OREB','DREB','PF'],athletes:[{athlete:{id:'99',displayName:'Test'},stats:['30:30','20','8-16','2-4','2-2','5','4','2','1','0','1','4','3']},{athlete:{id:'100'},didNotPlay:true,stats:[]}]}]}]}};
test('ESPN completed appearances, DNP excluded, weighted shooting and incomplete sample',()=>{const rows=parseBoxScore(summary,event);assert.equal(rows.length,1);assert.equal(rows[0].stats.MIN,30.5);assert.equal(parseBoxScore(summary,{...event,status:{type:{completed:false}}}).length,0);const w=gameWindows(rows,{asOf:new Date('2026-11-17')});assert.equal(w[1].values['FG%'],.5);assert.equal(w[3].complete,false);assert.equal(performanceTrend(w,{PTS:15})[1].delta.PTS,5);assert.equal(performanceTrend(w,{PTS:15})[3].delta.PTS,null)});
test('ingestion preserves errors and deduplicates event ids',async()=>{const d=await ingestGameLogs({dates:['20261116','20261116'],fetcher:async u=>({ok:true,json:async()=>u.includes('scoreboard')?{events:[event,event]}:summary})});assert.equal(d.completedEvents,1);assert.equal(d.rows.length,1);assert.equal(d.complete,true)});
test('z scores invert turnovers and gate missing pool',()=>{const players=Array.from({length:30},(_,i)=>({id:i,values:{FGM:3+i/10,FGA:10,FTM:2+i/20,FTA:4,'3PM':i/10,PTS:10+i,REB:2+i/2,AST:1+i/3,STL:i/20,BLK:i/30,TO:1+i/10}}));const z=zScores(players,{expectedPoolSize:30});assert.equal(z.available,true);assert.ok(z.rows.find(p=>p.id==='0').categories.TO>0);assert.equal(zScores(players,{expectedPoolSize:100}).available,false);assert.equal(zScores(players,{expectedPoolSize:30,punt:['TO']}).rows.length,30)});

test('Yahoo batched player stats reports silent omitted IDs as incomplete, not a successful full source',async()=>{
 const catalog={stats:[{stat:{stat_id:12,name:'Points',display_name:'PTS'}}]};
 const payload={players:{0:{player:[[{player_id:'42'}],{player_stats:{coverage_type:'average_season',stats:[{stat:{stat_id:12,value:'21.5'}}]}}]}}};
 const r=await loadPlayerStats({gameKey:'478',playerIds:['42','43'],batchSize:2,read:async path=>path.includes('stat_categories')?catalog:payload});
 assert.equal(r.requested,2);
 assert.equal(r.returned,1);
 assert.equal(r.complete,false);
 assert.deepEqual(r.missingIds,['43']);
 assert.ok(r.errors.some(x=>x.reason==='Incomplete Yahoo stat batch'));
});
