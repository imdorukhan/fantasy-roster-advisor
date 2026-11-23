import test from 'node:test';
import assert from 'node:assert/strict';
import {requireSc3Read} from './sc3-read-access.mjs';
import {hasProductionOwnerSession,sessionHash} from './api/auth/yahoo/_store.js';

const production={VERCEL_ENV:'production',SC3_SHARED_DB:'1',SC3_PRODUCTION_READS:'1',SC3_YAHOO_BRIDGE:'1'};
const preview={...production,VERCEL_ENV:'preview'};
const validId='a'.repeat(43);
const request=(id,method='GET')=>({method,headers:id===undefined?{}:{cookie:'yahoo_session='+id}});
const response=()=>({headers:{},code:null,setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.response=v;return this;}});
async function gate(req,env,verify){
 const res=response();
 const allowed=await requireSc3Read(req,res,{env,verify});
 return {allowed,status:res.code,headers:res.headers};
}
test('production is opt-in and requires the enrolled owner session for reads',async()=>{
 const check=async id=>id===validId;
 assert.equal((await gate(request(validId),{...production,SC3_PRODUCTION_READS:'0'},check)).status,404);
 assert.equal((await gate(request(validId),{...production,SC3_ISOLATED:'1'},check)).status,404);
 assert.equal((await gate(request(),production,()=>{throw Error('called');})).status,401);
 assert.equal((await gate(request('invalid'),production,()=>{throw Error('called');})).status,401);
 assert.equal((await gate(request('b'.repeat(43)),production,check)).status,401);
 const duplicate={method:'GET',headers:{cookie:'yahoo_session='+validId+'; yahoo_session='+validId}};
 assert.equal((await gate(duplicate,production,()=>{throw Error('called');})).status,401);
 const owner=await gate(request(validId),production,check);
 assert.equal(owner.allowed,true);
 assert.equal(owner.headers['Cache-Control'],'private, no-store');
 assert.equal((await gate(request(validId,'POST'),production,check)).status,405);
 assert.equal((await gate(request(validId),production,()=>{throw Error('store down');})).status,503);
 assert.equal((await gate(request(),preview,()=>{throw Error('called');})).allowed,true);
});
test('legacy owner lookup reads expiry and enrollment metadata only',async()=>{
 const now=new Date('2026-11-18T10:00:00Z');
 const reads=[];
 const readOwner=async query=>{reads.push(query);return [{singleton:true}];};
 const readSession=async query=>{reads.push(query);return [{expires_at:'2026-11-18T10:01:00Z'}];};
 assert.equal(await hasProductionOwnerSession(validId,{now,readSession,readOwner}),true);
 const filters=new URLSearchParams(reads[0].slice(1));
 assert.equal(filters.get('select'),'expires_at');
 assert.equal(filters.get('session_hash'),'eq.'+sessionHash(validId));
 assert.equal(new URLSearchParams(reads[1].slice(1)).get('select'),'singleton');
 assert.equal(await hasProductionOwnerSession(validId,{now,readSession,readOwner:async()=>[]}),false);
 const expired=async()=>[{expires_at:'2026-11-18T09:59:00Z'}];
 assert.equal(await hasProductionOwnerSession(validId,{now,readSession:expired,readOwner:()=>{throw Error('called');}}),false);
});
