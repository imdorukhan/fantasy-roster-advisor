import test from 'node:test';
import assert from 'node:assert/strict';
import {matchupProjection} from './sc3-matchup-projection.mjs';

const now=new Date('2026-11-18T19:00:00Z');
const player=(id)=>({yahooId:id,name:id,games:[{assignment:'STARTER'},{assignment:'BENCH'},{assignment:'IL'}],unknownDates:[]});
const report={complete:true,teams:[{id:5,name:'Ours',players:[player('1')]},{id:8,name:'Them',players:[player('2')]}]};
const stats={'3PM':1,PTS:11,REB:4,AST:3,STL:1,BLK:1,TO:1,FGM:3,FGA:5,FTM:4,FTA:6};
const team={stats:{...stats,'FG%':0.5,'FT%':0.5},shooting:{FGM:50,FGA:100,FTM:5,FTA:10}};
const official={ourTeam:team,opponent:team,observedAt:now.toISOString()};
const logs=['1','2'].flatMap(yahoo_id=>[stats,{...stats,FGM:1,FGA:10},stats].map(stats=>({yahoo_id,stats})));

test('weights shooting attempts and excludes bench and IL assignments',()=>{
 const p=matchupProjection(report,official,logs,'2026-11-17',{now,baselineAligned:true});
 assert.equal(p.teams[0].covered,1);
 assert.ok(Math.abs(p.teams[0].future['FG%']-7/20)<1e-12);
 assert.ok(Math.abs(p.endOfWeek.rows.find(r=>r.category==='FG%').ours-(50+7/3)/(100+20/3))<1e-12);
});
test('missing samples and stale scoreboard withhold the week-end scenario',()=>{
 const p=matchupProjection(report,{...official,observedAt:'2026-11-18T17:00:00Z'},logs.filter(x=>x.yahoo_id==='1'),'2026-11-17',{now,baselineAligned:false});
 assert.equal(p.teams[1].future,null);
 assert.equal(p.endOfWeek,null);
 assert.equal(p.blocked.length,2);
});
