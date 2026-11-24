import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlayerStats,playerStatRecords,statCatalog} from './yahoo-player-stats.mjs';
const names={'5':['Field Goal Percentage','FG%'],'8':['Free Throw Percentage','FT%'],'10':['Three Pointers Made','3PM'],'12':['Points','PTS'],'15':['Total Rebounds','REB'],'16':['Assists','AST'],'17':['Steals','STL'],'18':['Blocks','BLK'],'19':['Turnovers','TO'],'21':['Field Goals Made','FGM'],'22':['Field Goals Attempted','FGA'],'23':['Free Throws Made','FTM'],'24':['Free Throws Attempted','FTA']};
const categories={stat_categories:{stats:Object.entries(names).map(([id,[name,display_name]])=>({stat:{stat_id:id,name,display_name}}))}};
const values={'5':'.500','8':'.750','10':'2','12':'20','15':'6','16':'4','17':'1','18':'1','19':'2','21':'5','22':'10','23':'3','24':'4'};
const response=(coverageType)=>({players:{0:{player:[[{player_id:'42'}],{player_stats:{...(coverageType===undefined?{}:{coverage_type:coverageType}),stats:Object.entries(values).map(([stat_id,value])=>({stat:{stat_id,value}}))}}]}}});
test('actual Yahoo response without coverage_type is accepted only through explicit trusted window request',async()=>{
 const paths=[];
 const result=await loadPlayerStats({gameKey:'478',playerIds:['42'],coverage:'average_season',read:async p=>{paths.push(p);return p.includes('stat_categories')?categories:response(undefined)}});
 assert.match(paths[1],/\/stats;type=average_season\?format=json$/);
 assert.equal(result.returned,1);
 assert.equal(result.complete,true);
 assert.equal(result.nineCatReady,true);
 assert.equal(result.records.get('42').coverage,'average_season');
 assert.equal(result.records.get('42').coverageVerification,'EXPLICIT_YAHOO_WINDOW_REQUEST');
 assert.equal(result.records.get('42').values.PTS,20);
 // No source provenance -> no implicit time window.
 assert.equal(playerStatRecords(response(undefined),statCatalog(categories),{coverage:'average_season'}).size,0);
});
test('other windows are not conflated even when upstream omits coverage metadata',async()=>{
 for(const window of ['season','lastweek','lastmonth']){
  const paths=[];
  const result=await loadPlayerStats({gameKey:'478',playerIds:['42'],coverage:window,read:async p=>{paths.push(p);return p.includes('stat_categories')?categories:response(undefined)}});
  assert.match(paths[1],new RegExp('/stats;type='+window.replaceAll('_','_')+'\\?format=json$'));
  assert.equal(result.records.get('42').coverage,window);
 }
});
test('unexpected or explicit conflicting metadata still fails closed',async()=>{
 for(const bad of ['week','',null,'average']){
  const x=await loadPlayerStats({gameKey:'478',playerIds:['42'],coverage:'average_season',read:async p=>p.includes('stat_categories')?categories:response(bad)});
  assert.equal(x.returned,0);
  assert.equal(x.complete,false);
 }
});
