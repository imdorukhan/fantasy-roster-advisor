import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,verify} from 'node:crypto';
import {stageIssuer,CANONICAL} from './sc3-stage-issuer.mjs';
import {verifyProductionOwner,requireSc3Read} from './sc3-read-access.mjs';
const key=generateKeyPairSync('ed25519'),wrong=generateKeyPairSync('ed25519');
const hostname='salarycaptain-fixture123-dorukkosar-4371.vercel.app',id='dpl_fixture1234567890123456';
const env={SC3_STAGE_NOT_BEFORE:'1795579900',SC3_STAGE_NOT_AFTER:'1795581700',VERCEL_ENV:'production',SC3_SHARED_DB:'1',SC3_PRODUCTION_READS:'1',SC3_STAGE_ISSUER:'1',SC3_STAGE_TARGET_HOST:hostname,SC3_STAGE_TARGET_DEPLOYMENT_ID:id,SC3_STAGE_SIGNING_KEY:key.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')};
const challenge=createHash('sha256').update('fixture-proof').digest('base64url'),at=1795580000;
const q={sc3StageAuth:'approve'};
const req=(method='POST',changes={})=>({url:'/api/auto-data',method,query:method==='GET'?{...q,challenge}:q,headers:{host:CANONICAL,origin:'https://'+CANONICAL,'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin'},body:{challenge},...changes});
function res(){return {headers:{},code:null,setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this}}}
async function call(r=req(),e=env,owner=async()=>true,now=at){const out=res();await stageIssuer(r,out,{env:e,owner,now:()=>now});return out;}
test('minimal issuer defaults off, rejects preview, wrong host, mixed roles and invalid target',async()=>{
 for(const e of [{...env,SC3_STAGE_ISSUER:'0'},{...env,VERCEL_ENV:'preview'},{...env,SC3_STAGE_RECEIVER:'1'},{...env,SC3_ISOLATED:'1'},{...env,SC3_PRODUCTION_READS:'0'},{...env,SC3_STAGE_TARGET_HOST:'evil.example'},{...env,SC3_STAGE_TARGET_DEPLOYMENT_ID:'bad'}]){
  assert.equal((await call(req(),e,()=>{throw Error('must not verify')})).code,404);
 }
 assert.equal((await call(req('POST',{headers:{...req().headers,host:hostname}}))).code,404);
});
test('GET and POST require existing owner, owner failures never leak provider details',async()=>{
 for(const method of ['GET','POST']){
  assert.equal((await call(req(method),env,async()=>false)).code,401);
  const r=await call(req(method),env,async()=>{throw Error('fixture sensitive detail')});assert.equal(r.code,503);assert.ok(!JSON.stringify(r.body).includes('fixture sensitive'));
 }
 const a=await call(req('GET'));assert.equal(a.code,200);assert.ok(a.body.includes(hostname));assert.ok(a.body.includes(id));assert.ok(!a.body.includes('name="grant"'));assert.equal(a.headers['Set-Cookie'],undefined);
});
test('strict origin, method, query and form validation before owner verification',async()=>{
 const r=req();
 for(const headers of [{...r.headers,origin:'https://evil.example'},{...r.headers,origin:undefined},{...r.headers,'sec-fetch-site':'cross-site'}]){
  assert.equal((await call({...r,headers},env,()=>{throw Error('must not verify')})).code,403);
 }
 for(const change of [{query:{...q,sc3YahooSync:'1'}},{query:{...q,sc3StageAuth:['approve']}},{url:'/api/auth/yahoo/login'},{body:'challenge='+challenge+'&challenge='+challenge},{body:{challenge,extra:'x'}},{body:{challenge:'<script>'}},{headers:{...r.headers,'content-type':'application/json'}}]){
  assert.equal((await call({...r,...change},env,()=>{throw Error('must not verify')})).code,400);
 }
 assert.equal((await call(req('PUT'))).code,405);
 assert.equal((await call({...r,headers:{...r.headers,'sec-fetch-site':undefined}})).code,200); // older browsers may omit Fetch Metadata; Origin still mandatory.
});
test('Ed25519 private/public separation and protocol compatibility; body-only grant, exact audience, bounded expiry',async()=>{
 const r=await call();assert.equal(r.code,200);
 const grant=r.body.match(/name="grant" value="([^"]+)"/)[1],bits=grant.split('.');
 assert.ok(verify(null,Buffer.from(bits[0]),key.publicKey,Buffer.from(bits[1],'base64url')));
 assert.equal(verify(null,Buffer.from(bits[0]),wrong.publicKey,Buffer.from(bits[1],'base64url')),false);
 const p=JSON.parse(Buffer.from(bits[0],'base64url'));
 assert.deepEqual(p,{v:2,iss:CANONICAL,aud:hostname,dpl:id,scope:'sc3-acceptance-read-v1',nonce:challenge,windowStart:at-100,windowEnd:at+1700,iat:at,exp:at+300,handoff:at+60});
 assert.ok(r.body.includes('action="https://'+hostname+'/api/auto-data?sc3StageAuth=exchange"'));assert.ok(!r.body.includes('?grant='));assert.equal(r.headers['Set-Cookie'],undefined);
 assert.match(r.headers['Cache-Control'],/no-store/);assert.equal(r.headers['Referrer-Policy'],'strict-origin');assert.match(r.headers['Content-Security-Policy'],/default-src 'none'/);assert.equal(r.headers['Cross-Origin-Opener-Policy'],'same-origin');
 for(const bad of [key.publicKey.export({format:'der',type:'spki'}).toString('base64'),'invalid',generateKeyPairSync('ec',{namedCurve:'prime256v1'}).privateKey.export({format:'der',type:'pkcs8'}).toString('base64')])assert.equal((await call(req(),{...env,SC3_STAGE_SIGNING_KEY:bad})).code,503);
});
test('stateless duplicate consent can reissue same capability; no false single-use claim',async()=>{
 const a=await call(),b=await call();assert.equal(a.body,b.body);
 const c=await call(req(),env,async()=>true,at+61);assert.notEqual(c.body,a.body);
 // Existing canonical gate still does not accept staging cookies.
 const request={method:'GET',headers:{cookie:'__Host-sc3_stage_grant=fixture'}};
 const out=res();assert.equal(await requireSc3Read(request,out,{env,verify:async()=>true}),false);assert.equal(out.code,401);
 const sid='a'.repeat(43);assert.equal(await verifyProductionOwner({headers:{cookie:'yahoo_session='+sid}},{verify:async id=>id===sid}),true);
 assert.equal(await verifyProductionOwner({headers:{cookie:'yahoo_session='+sid+'; yahoo_session='+sid}},{verify:async()=>true}),false);
});

test('issuer requires fixed valid maximum 30-minute window and refuses late owner completion',async()=>{
 const end=at+1700;
 for(const e of [{...env,SC3_STAGE_NOT_BEFORE:undefined},{...env,SC3_STAGE_NOT_AFTER:undefined},{...env,SC3_STAGE_NOT_AFTER:'not-a-date'},{...env,SC3_STAGE_NOT_AFTER:String(end+1)},{...env,SC3_STAGE_NOT_AFTER:String(at-100)}]){
  assert.equal((await call(req(),e,()=>{throw Error('must not verify')})).code,404);
 }
 for(const now of [at-101,end,end+3600])assert.equal((await call(req(),env,async()=>true,now)).code,404);
 assert.equal((await call(req(),env,async()=>true,at-100)).code,200);
 const out=await call(req(),env,async()=>true,end-1);assert.equal(out.code,200);
 const payload=JSON.parse(Buffer.from(out.body.match(/name="grant" value="([^"]+)"/)[1].split('.')[0],'base64url'));
 assert.equal(payload.exp,end);assert.equal(payload.handoff,end);
 let clock=end-1;const r=res();await stageIssuer(req(),r,{env,now:()=>clock,owner:async()=>{clock=end;return true}});assert.equal(r.code,404);
});
