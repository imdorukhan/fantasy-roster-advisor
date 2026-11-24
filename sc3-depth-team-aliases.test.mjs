import test from 'node:test';
import assert from 'node:assert/strict';
import {espnDepth} from './api/auto-data.js';
import {teams,teamCode} from './sc3-depth-store.mjs';

test('ESPN fallback normalizes every NBA team and common aliases without using color metadata',async t=>{
 const aliases={GS:'GSW',NO:'NOP',NY:'NYK',SA:'SAS',WSH:'WAS'};
 const catalog=teams.map((abbreviation,i)=>({team:{abbreviation,id:String(i+1),alternateColor:'SAS'}}));
 const requested=[];
 t.mock.method(globalThis,'fetch',async url=>{
  if(url.endsWith('/teams'))return {ok:true,json:async()=>({sports:[{leagues:[{teams:catalog}]}]})};
  const id=url.match(/\/teams\/(\d+)\/depthcharts$/)?.[1];
  assert.ok(id);requested.push(id);
  return {ok:true,json:async()=>({depthchart:[{positions:Object.fromEntries(['pg','sg','sf','pf','c'].map(position=>[position,{athletes:[{id:'123',displayName:'Fixture Player'}]}]))}]})};
 });
 for(const canonical of teams){
  const input=aliases[canonical]||canonical;
  const result=await espnDepth(input);
  assert.equal(result.nbaTeam,canonical);
  assert.equal(result.rows.length,5);
  assert.equal(requested.at(-1),String(teams.indexOf(canonical)+1));
  assert.equal(teamCode(input),canonical);
 }
 assert.equal(requested.length,30);
 await assert.rejects(espnDepth('ZZZ'),/Unknown NBA team/);
});
