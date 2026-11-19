import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTables,validateRows,depthSync,saveDepth,verifyDepth} from './sc3-depth-sync.mjs';
import {depthSource} from './sc3-depth-store.mjs';
const names='Atlanta|Boston|Brooklyn|Charlotte|Chicago|Cleveland|Dallas|Denver|Detroit|Golden State|Houston|Indiana|LA Clippers|LA Lakers|Memphis|Miami|Milwaukee|Minnesota|New Orleans|New York|Oklahoma City|Orlando|Philadelphia|Phoenix|Portland|Sacramento|San Antonio|Toronto|Utah|Washington'.split('|');
const tables=()=>names.map((header,i)=>({header,rows:['PG','SG','SF','PF','C'].map((pos,j)=>({text:pos+'1 - Player '+i+' '+j,name:'Player '+i+' '+j,href:`https://www.espn.com/nba/player/_/id/${100+i*5+j}/player`}))}));
const secret='fixture-cron-secret-with-at-least-32-characters';
const req=()=>({method:'GET',headers:{authorization:'Bearer '+secret}});
const res=()=>({setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});
test('complete source tables require every team, position, rank and ESPN identity',()=>{
  const t=tables();t[0].rows[0].text+=' (IL)';const rows=parseTables(t);
  assert.equal(rows.length,150);assert.equal(rows[0].injury_marker,'IL');
  for(const change of [t=>t.pop(),t=>t[0].header='Unknown',t=>t[0].rows[0].text='PG2 - Player 0 0',t=>t[0].rows[0].href='https://example.com/123',t=>t[0].rows[0].text+=' (O)']){
    const bad=tables();change(bad);assert.throws(()=>parseTables(bad));
  }
  assert.throws(()=>validateRows([...rows,{...rows[0]}]));
});
test('authorization and disable gates precede collection, dry run never saves',async()=>{
  let collected=0;const options={env:{CRON_SECRET:secret,SC3_SHARED_DB:'1',SC3_DEPTH_SYNC_ENABLED:'1'},collect:async()=>{collected++;return {rows:parseTables(tables()),source:depthSource,observedAt:new Date().toISOString()};},save:()=>assert.fail('Unexpected write'),log:()=>{}};
  const denied=res();await depthSync({method:'GET',headers:{}},denied,options);assert.equal(denied.code,401);assert.equal(collected,0);
  const result=res();await depthSync(req(),result,options);assert.equal(result.body.status,'VALIDATED');assert.equal(result.body.snapshotWrites,0);assert.equal(collected,1);
});
const url=process.env.YAHOO_REFRESH_TEST_DATABASE_URL;
test('depth replacement is atomic, rejects stale observations and verifies exact time on PostgreSQL',{skip:!url},async t=>{
  const {Pool}=await import('pg'),parsed=new URL(url);assert.ok(['localhost','127.0.0.1'].includes(parsed.hostname));assert.equal(parsed.pathname,'/sc3_refresh_test');
  const admin=new Pool({connectionString:url}),name='sc3_depth_'+process.pid;await admin.query('create database '+name);parsed.pathname='/'+name;
  const pool=new Pool({connectionString:parsed.href});t.after(async()=>{await pool.end();await admin.query('drop database '+name);await admin.end();});
  await pool.query('create schema sc3;create table sc3.nba_depth_chart(nba_team text,position text,rank integer,espn_id text,player_name text,injury_marker text,observed_at timestamptz,source text)');
  const transaction=async(fn,{readOnly}={})=>{const client=await pool.connect();try{await client.query(readOnly?'begin read only':'begin');const r=await fn(client);await client.query('commit');return r;}catch(e){await client.query('rollback');throw e;}finally{client.release();}};
  const options={transaction},batch={rows:parseTables(tables()),source:depthSource,observedAt:new Date().toISOString()};
  assert.equal((await saveDepth(batch,options)).changed,true);assert.equal((await verifyDepth(batch,options)).rows,150);
  await assert.rejects(saveDepth(batch,options),{code:'older_observation'});
  await pool.query("create function sc3.reject_row() returns trigger language plpgsql as $$begin raise exception 'fixture';end$$;create trigger reject_row before insert on sc3.nba_depth_chart for each row execute function sc3.reject_row()");
  await assert.rejects(saveDepth({...batch,observedAt:new Date(Date.now()+1).toISOString()},options));
  assert.equal((await verifyDepth(batch,options)).rows,150);
});
