import test from 'node:test';
import assert from 'node:assert/strict';
import {rosterStatSource} from './sc3-roster-stat-source.mjs';
const season={complete:true,games:14,values:{PTS:25,REB:7,AST:5,STL:1.1,BLK:1,TO:2,'FG%':.51,'FT%':.8,MPG:31}};
const performance={fresh:true,historyEnd:'2026-11-22',season};
test('when Yahoo has no live stats, roster shows only complete, fresh ESPN season averages',()=>{
 const out=rosterStatSource({yahooId:'10094'},performance);
 assert.equal(out.source,'ESPN completed-game season averages');
 assert.equal(out.through,'2026-11-22');
 assert.equal(out.values.GP,14);
 assert.equal(out.values.PTS,25);
});
test('Yahoo verified live player values take precedence and are not mixed with ESPN',()=>{
 const live={stats:{values:{PTS:28}}};
 const out=rosterStatSource(live,performance);
 assert.equal(out.source,'Yahoo player statistics');
 assert.deepEqual(out.values,{PTS:28});
 assert.equal(out.through,null);
});
test('incomplete or stale ESPN data never becomes a stat fallback',()=>{
 for(const p of [{...performance,fresh:false},{...performance,season:{...season,complete:false}},{...performance,historyEnd:null},{...performance,season:{...season,values:{...season.values,PTS:null}}}]){
  const out=rosterStatSource({},p);
  assert.equal(out.source,'Unavailable');
  assert.equal(out.values,null);
 }
});
