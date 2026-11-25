import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {stageAuth,allowedStageRead,hasStageRead,CANONICAL} from './sc3-stage-auth.mjs';
import {requireSc3Read} from './sc3-read-access.mjs';
const keys=generateKeyPairSync('ed25519');
const target='salarycaptain-fixture123-dorukkosar-4371.vercel.app',id='dpl_fixture1234567890123456';
const at=1795580000;
const base={VERCEL_ENV:'production',SC3_SHARED_DB:'1',SC3_PRODUCTION_READS:'1'};
const iss={...base,SC3_STAGE_ISSUER:'1',SC3_STAGE_TARGET_HOST:target,SC3_STAGE_TARGET_DEPLOYMENT_ID:id,SC3_STAGE_SIGNING_KEY:keys.privateKey.export({format:'der',type:'pkcs8'}).toString('base64')};
const rec={...base,SC3_STAGE_RECEIVER:'1',VERCEL_URL:target,VERCEL_DEPLOYMENT_ID:id,SC3_STAGE_VERIFY_KEY:keys.publicKey.export({format:'der',type:'spki'}).toString('base64')};
const proof='a'.repeat(43);
const path='/api/auto-data';
function request(host,query,method='GET',headers={},body){return {method,url:path,query,headers:{host,...headers},body};}
function response(){return {headers:{},code:null,setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.body=v;return this},send(v){this.body=v;return this},end(){return this}}}
const formHeaders={'content-type':'application/x-www-form-urlencoded',origin:'https://'+CANONICAL};
async function call(req,env,{owner=async()=>true,now=at}={}){
 const res=response();await stageAuth(req,res,{env,owner,now:()=>now,random:()=>proof});return res;
}
function cookiesFrom(res){return (res.headers['Set-Cookie']??[]).filter(x=>!/Max-Age=0(?:;|$)/.test(x)).map(x=>x.split(';')[0]).join('; ');}
async function issue(){
 const begin=await call(request(target,{sc3StageAuth:'begin'}),rec);
 assert.equal(begin.code,200);const challenge=begin.body.match(/challenge=([A-Za-z0-9_-]{43})/)[1];
 const approval=await call(request(CANONICAL,{sc3StageAuth:'approve',challenge}),iss);
 assert.equal(approval.code,200);assert.ok(approval.body.includes(target));assert.ok(approval.body.includes(id));
 const res=await call(request(CANONICAL,{sc3StageAuth:'approve'},'POST',{...formHeaders,'sec-fetch-site':'same-origin'},{challenge}),iss);
 assert.equal(res.code,200);const grant=res.body.match(/name="grant" value="([^"]+)"/)[1];
 return {begin,challenge,grant,pending:cookiesFrom(begin),approval:res};
}
async function exchange(fixture,env=rec,now=at,headers={}){
 return call(request(target,{sc3StageAuth:'exchange'},'POST',{...formHeaders,cookie:fixture.pending,...headers},{grant:fixture.grant}),env,{now});
}
test('fixture owner consent issues deployment-bound signed capability; no owner credentials in grant or URL',async()=>{
 const f=await issue();
 assert.match(f.begin.headers['Set-Cookie'][0],/^__Host-.*; Path=\/; Secure; HttpOnly; SameSite=None;/);
 assert.equal(f.approval.headers['Referrer-Policy'],'strict-origin');
 assert.match(f.approval.headers['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.match(f.approval.headers['Content-Security-Policy'],new RegExp('form-action https://'+target.replaceAll('.','\\.')));
 const p=JSON.parse(Buffer.from(f.grant.split('.')[0],'base64url').toString());
 assert.deepEqual(Object.keys(p).sort(),['aud','dpl','exp','handoff','iat','iss','nonce','scope','v'].sort());
 assert.equal(p.exp-p.iat,300);assert.equal(p.handoff-p.iat,60);assert.equal(p.nonce,f.challenge);assert.equal(p.aud,target);assert.equal(p.dpl,id);
 assert.notEqual(p.nonce,proof);assert.equal(f.approval.headers['Set-Cookie'],undefined);
 const ex=await exchange(f);assert.equal(ex.code,200);assert.equal(ex.headers.Location,undefined);assert.ok(ex.body.includes('href="https://'+target+path+'?sc3StageAuth=status"'));
 assert.ok(!ex.body.includes(f.grant));assert.ok(!ex.body.includes(proof));assert.match(ex.headers['Cache-Control'],/no-store/);assert.match(ex.headers['Content-Security-Policy'],/form-action 'none'/);assert.equal(ex.headers['Set-Cookie'].length,3);
 assert.match(ex.headers['Set-Cookie'][0],/Max-Age=0/);assert.match(ex.headers['Set-Cookie'][1],/HttpOnly; SameSite=Lax; Max-Age=300/);
 const cookie=cookiesFrom(ex);
 const status=await call(request(target,{sc3StageAuth:'status'},'GET',{cookie}),rec);assert.equal(status.code,200);assert.equal(status.body.readOnly,true);assert.equal(status.body.deploymentId,id);
});
test('issuer requires canonical origin and existing owner approval; default off and bad keys fail closed',async()=>{
 const f=await issue();const req=request(CANONICAL,{sc3StageAuth:'approve'},'POST',formHeaders,{challenge:f.challenge});
 assert.equal((await call(req,iss,{owner:async()=>false})).code,401);
 assert.equal((await call(req,iss,{owner:async()=>{throw Error('private details')}})).code,503);
 assert.equal((await call({...req,headers:{...req.headers,origin:'https://evil.example'}},iss)).code,403);
 assert.equal((await call({...req,headers:{...req.headers,'sec-fetch-site':'cross-site'}},iss)).code,403);
 assert.equal((await call({...req,headers:{...req.headers,host:target}},iss)).code,404);
 assert.equal((await call(req,{...iss,SC3_STAGE_ISSUER:'0'})).code,404);
 assert.equal((await call(req,{...iss,SC3_STAGE_SIGNING_KEY:'invalid'})).code,503);
 assert.equal((await call(request(target,{sc3StageAuth:'begin'}),{...rec,SC3_STAGE_RECEIVER:'0'})).code,404);
 assert.equal((await call(request(target,{sc3StageAuth:'begin'}),{...rec,VERCEL_URL:'salarycaptain.vercel.app'})).code,404);
});
test('reject tampering, wrong deployment, stolen grant without proof, wrong origin and expired handoff',async()=>{
 const f=await issue();
 const alter=f.grant.split('.');alter[0]=Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(alter[0],'base64url')),exp:at+3600})).toString('base64url');
 assert.equal((await exchange({...f,grant:alter.join('.')})).code,401);
 assert.equal((await exchange(f,{...rec,VERCEL_DEPLOYMENT_ID:'dpl_different123456789012'})).code,401);
 assert.equal((await exchange({...f,pending:''})).code,401);
 assert.equal((await exchange({...f,pending:'__Host-sc3_stage_pending='+'b'.repeat(43)})).code,401);
 assert.equal((await exchange(f,rec,at+60)).code,401);
 assert.equal((await exchange(f,rec,at-1)).code,401);
 assert.equal((await exchange(f,rec,at,{origin:'https://evil.example'})).code,403);
 const stolen=await exchange(f);const cookie=cookiesFrom(stolen);
 const q={sc3LeagueRosters:'1'};
 assert.equal(hasStageRead(request(target,q,'GET',{cookie}),rec,at+299),true);
 assert.equal(hasStageRead(request(target,q,'GET',{cookie}),rec,at+300),false);
 assert.equal(hasStageRead(request(target,q,'GET',{cookie:cookie.split('; ').find(x=>x.startsWith('__Host-sc3_stage_grant='))}),rec,at),false);
 assert.equal(hasStageRead(request(CANONICAL,q,'GET',{cookie}),rec,at),false);
 assert.equal(hasStageRead(request(target,q,'GET',{cookie,'sec-fetch-site':'cross-site'}),rec,at),false);
 assert.equal(hasStageRead(request(target,q,'GET',{cookie:cookie+'; '+cookie}),rec,at),false);
});
test('strict exact GET scope excludes every writer, OAuth, cron and mixed query',async()=>{
 const allowed=[{sc3LeagueRosters:'1'},{sc3P2Lab:'1'},{sc3Streaming:'1',waiverImpact:'1'},{live:'1',officialMatchup:'1'},{sc3MatchupLineups:'1',projection:'1',forecast:'1'},{sc3Player:'1',id:'5159',dropId:'123'}];
 const denied=[{live:'1'},{live:'1',leagueData:'1'},{live:'1',freeAgents:'1'},{sc3P22Collect:'1'},{sc3DailySync:'1'},{sc3YahooSync:'1'},{sc3ScoreboardSync:'1'},{sc3NbaHistorySync:'1'},{sc3DepthSync:'1'},{cron:'1'},{sc3LeagueRosters:'1',cron:'1'},{sc3LeagueRosters:['1']},{sc3Player:'1',id:'x'},{sc3P22Probe:'1',part:'history'}];
 const f=await issue(),cookie=cookiesFrom(await exchange(f));
 for(const q of allowed){const r=request(target,q,'GET',{cookie});assert.ok(allowedStageRead(r));assert.ok(hasStageRead(r,rec,at));assert.equal(hasStageRead({...r,method:'POST'},rec,at),false);assert.equal(hasStageRead({...r,url:'/api/auth/yahoo/login'},rec,at),false);}
 for(const q of denied)assert.equal(hasStageRead(request(target,q,'GET',{cookie}),rec,at),false);
 const real=await call(request(target,{sc3StageAuth:'clear'},'POST',{origin:'https://'+target,cookie}),rec);assert.equal(real.code,200);assert.equal(cookiesFrom(real),'');
 assert.equal((await call(request(target,{sc3StageAuth:'clear'},'POST',{origin:'https://evil.example'}),rec)).code,403);
});
test('actual production read gate preserves owner auth and denies stage grant on canonical or wrong scope',async()=>{
 // Use real current time for gate's clock; all credentials here are generated fixtures.
 const now=Math.floor(Date.now()/1000);
 const begin=await call(request(target,{sc3StageAuth:'begin'}),rec,{now});
 const challenge=begin.body.match(/challenge=([A-Za-z0-9_-]{43})/)[1];
 const approval=await call(request(CANONICAL,{sc3StageAuth:'approve'},'POST',formHeaders,{challenge}),iss,{now});
 const grant=approval.body.match(/name="grant" value="([^"]+)"/)[1];
 const ex=await exchange({grant,pending:cookiesFrom(begin)},rec,now);
 const cookie=cookiesFrom(ex);
 for(const [host,q,env,expected] of [[target,{sc3LeagueRosters:'1'},rec,true],[CANONICAL,{sc3LeagueRosters:'1'},rec,false],[target,{sc3LeagueRosters:'1',cron:'1'},rec,false],[target,{sc3LeagueRosters:'1'},{...rec,SC3_STAGE_RECEIVER:'0'},false]]){
  const r=response();assert.equal(await requireSc3Read(request(host,q,'GET',{cookie}),r,{env,verify:async()=>false}),expected);
  if(!expected)assert.equal(r.code,401);
 }
 const r=response();assert.equal(await requireSc3Read(request(CANONICAL,{sc3LeagueRosters:'1'},'GET',{cookie:'yahoo_session='+'b'.repeat(43)}),r,{env:base,verify:async()=>true}),true);
});

test('committed landing creates a new navigation without relaxing status or read checks',async()=>{
 const f=await issue();
 const ex=await exchange(f,rec,at,{'sec-fetch-site':'cross-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'});
 assert.equal(ex.code,200);const cookie=cookiesFrom(ex);
 for(const site of ['cross-site','same-site']){
  const r=await call(request(target,{sc3StageAuth:'status'},'GET',{cookie,'sec-fetch-site':site}),rec);assert.equal(r.code,401);
  assert.equal(hasStageRead(request(target,{sc3LeagueRosters:'1'},'GET',{cookie,'sec-fetch-site':site}),rec,at),false);
 }
 for(const site of ['same-origin','none']){
  const r=await call(request(target,{sc3StageAuth:'status'},'GET',{cookie,'sec-fetch-site':site}),rec);assert.equal(r.code,200);
 }
 assert.equal((await exchange(f,rec,at,{'sec-fetch-mode':'cors'})).code,403);
 assert.equal((await exchange(f,rec,at,{'sec-fetch-dest':'iframe'})).code,403);
 assert.equal((await call(request(target,{sc3StageAuth:'begin'},'GET',{'sec-fetch-site':'cross-site'}),rec)).code,403);
 assert.equal((await call(request(target,{sc3StageAuth:'clear'},'POST',{origin:'https://'+target,'sec-fetch-site':'cross-site',cookie}),rec)).code,403);
});
test('receiver is production-only and rejects private key or mixed issuer configuration',async()=>{
 const f=await issue(),cookie=cookiesFrom(await exchange(f));
 for(const env of [{...rec,VERCEL_ENV:'preview'},{...rec,SC3_STAGE_SIGNING_KEY:'fixture-private-key-present'},{...rec,SC3_STAGE_ISSUER:'1'},{...rec,SC3_PRODUCTION_READS:'0'},{...rec,SC3_ISOLATED:'1'}]){
  assert.equal((await exchange(f,env)).code,404);
  assert.equal(hasStageRead(request(target,{sc3LeagueRosters:'1'},'GET',{cookie}),env,at),false);
 }
});
test('ordinary browser proof consumption, expiry and stateless replay limitation are explicit',async()=>{
 const f=await issue(),ex=await exchange(f);
 assert.match(ex.headers['Set-Cookie'][0],/Max-Age=0/);
 assert.equal((await exchange({...f,pending:cookiesFrom(ex)})).code,401);
 // A captured original proof and grant can still be replayed within 60s.
 assert.equal((await exchange(f,rec,at+59)).code,200);
 assert.equal((await exchange(f,rec,at+60)).code,401);
 const cookie=cookiesFrom(ex);
 assert.equal((await call(request(target,{sc3StageAuth:'status'},'GET',{cookie}),rec,{now:at+300})).code,401);
});
