import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateImpact,applyWaiverImpact} from './sc3-waiver-impact.mjs';

const stats={'3PM':1,PTS:12,REB:3,AST:4,STL:2,BLK:1,TO:2,FGM:2,FGA:10,FTM:4,FTA:4};
const ours={'3PM':3,PTS:40,REB:20,AST:15,STL:5,BLK:5,TO:3,'FG%':.5,'FT%':.75};
const other={...ours,PTS:64,TO:2,'FG%':.55};
const matchup={ourTeam:{stats:ours,shooting:{FGM:20,FGA:40,FTM:6,FTA:8}},opponent:{stats:other}};
test('shots are weighted by volume and turnovers penalize a trailing or tied target',()=>{
 const value=candidateImpact([stats,stats,stats],2,matchup);
 assert.equal(value.delta.PTS,24);
 assert.ok(Math.abs(value.delta['FG%']-(24/60-.5))<1e-12);
 assert.equal(value.progress.TO,-1);
 assert.equal(value.progress.PTS,1);
 assert.equal(candidateImpact([stats],2,matchup),null);
});
test('only verified histories break equal-start ties and additional starts retain priority',()=>{
 const row=(yahooId,name,extraStarts)=>({yahooId,name,extraStarts});
 const logs=['1','2'].flatMap(yahoo_id=>Array.from({length:3},()=>({yahoo_id,stats:{...stats,TO:yahoo_id==='1'?0:4}})));
 const result=applyWaiverImpact([row('1','Zed',1),row('2','Ann',1),row('3','High',2)],logs,matchup);
 assert.deepEqual(result.map(r=>r.yahooId),['3','1','2']);
 assert.equal(result[0].impact,null);
});
