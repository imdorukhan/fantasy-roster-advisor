import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './api/auto-data.js';
const response=()=>({statusCode:200,headers:{},body:null,
 setHeader(k,v){this.headers[k]=v;return this;},
 status(v){this.statusCode=v;return this;},
 json(v){this.body=v;return this;}});
const request=(method='GET')=>({method,headers:{},query:{sc3Health:'1'}});
test('production SC3 health requires owner authentication rather than returning unconditional 404',async()=>{
 const prev={...process.env};
 try{
  Object.assign(process.env,{VERCEL_ENV:'production',SC3_SHARED_DB:'1',SC3_PRODUCTION_READS:'1',SC3_ISOLATED:'0'});
  const anon=response();
  await handler(request(),anon);
  assert.equal(anon.statusCode,401);
  assert.equal(anon.headers['Cache-Control'],'private, no-store');
  const post=response();
  await handler(request('POST'),post);
  assert.equal(post.statusCode,405);
 }finally{
  for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];
  Object.assign(process.env,prev);
 }
});
test('production SC3 health disabled flag stays invisible (404)',async()=>{
 const prev={...process.env};
 try{
  Object.assign(process.env,{VERCEL_ENV:'production',SC3_SHARED_DB:'1',SC3_PRODUCTION_READS:'0'});
  const res=response();await handler(request(),res);assert.equal(res.statusCode,404);
 }finally{for(const k of Object.keys(process.env))if(!(k in prev))delete process.env[k];Object.assign(process.env,prev)}
});
