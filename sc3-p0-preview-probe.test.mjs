import test from 'node:test';
import assert from 'node:assert/strict';
import {p0PreviewProbe} from './sc3-p0-preview-probe.mjs';
const res=()=>({setHeader(){},status(n){this.code=n;return this},json(x){this.body=x;return this}});
test('P0 probe rejects production, disabled Preview and non-GET before source access',async()=>{
 for(const [env,method,code] of [[{VERCEL_ENV:'production',SC3_P0_PREVIEW_PROBE:'1'},'GET',404],[{VERCEL_ENV:'preview'},'GET',404],[{VERCEL_ENV:'preview',SC3_P0_PREVIEW_PROBE:'1'},'POST',405]]){
  const r=res();await p0PreviewProbe({method},r,{env,fetcher:()=>assert.fail('no fetch'),collect:()=>assert.fail('no collect')});assert.equal(r.code,code);
 }
});
test('P0 read-only probe verifies empty schedule and completed history without a write',async()=>{
 const r=res();
 await p0PreviewProbe({method:'GET'},r,{env:{VERCEL_ENV:'preview',SC3_P0_PREVIEW_PROBE:'1'},now:new Date('2026-11-24T10:00Z'),fetcher:async()=>({ok:true,json:async()=>({leagues:[{slug:'nba'}],events:[]})}),collect:async()=>({complete:true,requestedDates:['20261123'],observedAt:'2026-11-24T10:00Z',completedEvents:0,rows:[]})});
 assert.equal(r.code,200);assert.equal(r.body.days.length,6);assert.equal(r.body.snapshotWrites,0);assert.equal(r.body.history.day,'2026-11-23');assert.equal(r.body.readOnly,true);
});
