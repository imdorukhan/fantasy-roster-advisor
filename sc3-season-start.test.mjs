import test from 'node:test';
import assert from 'node:assert/strict';
import {readScopedRows} from './sc3-postgres.mjs';
function fixture(){
 const queries=[];
 const c={query:async(sql,params)=>{
  queries.push({sql,params});
  if(sql.includes('session_user as login'))return {rows:[{role:'sc3_app',login:'sc3_app',allowed:true,legacy_access:false}]};
  if(sql.includes('min(game_day)'))return {rows:[{start:'2026-10-20'}]};
  return {rows:[]};
 },release(){}};
 return {pool:{connect:async()=>c},queries};
}
test('scoped NBA reads without SC3_SEASON_START use earliest complete stored day',async()=>{
 const f=fixture();
 const result=await readScopedRows({pool:f.pool,end:'2026-11-22'});
 assert.equal(result.start,'2026-10-20');
 const queries=f.queries.filter(q=>q.sql.includes('game_day between'));
 assert.equal(queries.length,2);
 assert.ok(queries.every(q=>q.params[0]==='2026-10-20'&&q.params[1]==='2026-11-22'));
 assert.ok(f.queries.every(q=>!/^(insert|update|delete|alter|drop)/i.test(q.sql)));
});
test('provided authoritative start remains unchanged and does not query earliest day',async()=>{
 const f=fixture();const result=await readScopedRows({pool:f.pool,start:'2026-10-25',end:'2026-11-22'});
 assert.equal(result.start,'2026-10-25');
 assert.equal(f.queries.filter(q=>q.sql.includes('min(game_day)')).length,0);
});
