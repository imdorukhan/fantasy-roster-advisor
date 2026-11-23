import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlayerStats} from './yahoo-player-stats.mjs';
const specs={'5':['Field Goal Percentage','FG%'],'8':['Free Throw Percentage','FT%'],'10':['Three Pointers Made','3PM'],'12':['Points','PTS'],'15':['Total Rebounds','REB'],'16':['Assists','AST'],'17':['Steals','STL'],'18':['Blocks','BLK'],'19':['Turnovers','TO'],'21':['Field Goals Made','FGM'],'22':['Field Goals Attempted','FGA'],'23':['Free Throws Made','FTM'],'24':['Free Throws Attempted','FTA']};
const catalog={stat_categories:{stats:Object.entries(specs).map(([id,[name,display_name]])=>({stat:{stat_id:id,name,display_name}}))}};
const values={'5':'.500','8':'.750','10':'2','12':'20','15':'6','16':'4','17':'1','18':'1','19':'2','21':'5','22':'10','23':'3','24':'4'};
const packet=(data)=>({players:{0:{player:[[{player_id:'42'}],{player_stats:{coverage_type:'average_season',stats:Object.entries(data).map(([id,value])=>({stat:{stat_id:id,value}}))}}]}}});
const query=data=>loadPlayerStats({gameKey:'478',playerIds:['42'],read:async path=>path.includes('stat_categories')?catalog:packet(data)});
test('partial Yahoo 9-CAT player rows do not become actionable model evidence',async()=>{
 const result=await query({'12':'20'});
 assert.equal(result.complete,true,'The Yahoo player record itself was returned');
 assert.equal(result.nineCatReady,false,'Nine categories were not returned');
 assert.ok(result.missingNineCatById['42'].includes('FG%'));
 assert.ok(result.missingNineCatById['42'].includes('FGA'));
});
test('all nine categories plus attempt-weighted shooting produce complete descriptive source coverage',async()=>{
 const result=await query(values);
 assert.equal(result.nineCatReady,true);
 assert.deepEqual(result.missingNineCatById['42'],[]);
 assert.equal(result.complete,true);
});
test('disagreement between field goal percent and shooting volume cannot qualify a row',async()=>{
 const result=await query({...values,'5':'.700'});
 assert.equal(result.nineCatReady,false);
 assert.ok(result.invalidNineCatById['42'].includes('FG%'));
});
