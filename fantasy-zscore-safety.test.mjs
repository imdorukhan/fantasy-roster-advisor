import test from 'node:test';
import assert from 'node:assert/strict';
import {zScores} from './fantasy-zscore.mjs';
const players=Array.from({length:30},(_,i)=>({id:String(i+1),values:{
 FGM:4+i/50,FGA:9,FTM:2,FTA:3,'3PM':1+i/40,
 PTS:10+i,REB:3+i/10,AST:2+i/12,STL:0.5+i/30,BLK:i/40,TO:1+i/25
}}));
test('Punt player z-score refuses unrecognized or duplicate excluded category keys',()=>{
 assert.equal(zScores(players,{expectedPoolSize:30,punt:['PF']}).available,false);
 assert.equal(zScores(players,{expectedPoolSize:30,punt:['TO','TO']}).available,false);
});
test('duplicate Yahoo player IDs cannot be silently overwritten in a complete comparison pool',()=>{
 const input=[...players,{...players[0],values:{...players[0].values,PTS:999}}];
 assert.equal(zScores(input,{expectedPoolSize:30}).available,false);
});
test('physically impossible 3PM greater than FGM is excluded from calibrated pool eligibility',()=>{
 const bad={...players[0],values:{...players[0].values,'3PM':20}};
 const a=zScores([bad,...players.slice(1)],{expectedPoolSize:30,minPool:29});
 assert.equal(a.available,true);
 assert.ok(!a.rows.some(x=>x.id==='1'));
 assert.equal(a.eligible,29);
});
