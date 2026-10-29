import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {seal,unseal,configured,redirect,ownerGuid,yahooAccountGuid,yahooAccessDiagnostics,YahooFantasyError} from './_lib.js';
import {tokenEncrypt,tokenDecrypt,sessionId,sessionHash} from './_store.js';
import login from './login.js';
import callback from './callback.js';
import logout from './logout.js';
import refresh from './refresh.js';
const original={...process.env};
function env(){process.env.YAHOO_SESSION_SECRET='a'.repeat(64);process.env.YAHOO_CLIENT_ID='test-id';process.env.YAHOO_CLIENT_SECRET='test-secret';process.env.YAHOO_OWNER_GUID='test-owner-guid';process.env.YAHOO_BOOTSTRAP_SECRET='b'.repeat(40);process.env.SALARYCAPTAIN_SUPABASE_URL='https://example.supabase.co';process.env.SALARYCAPTAIN_SUPABASE_SECRET_KEY='test-only'}
function response(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(x){this.body=x;return this},send(x){this.body=x;return this},writeHead(n,h){this.code=n;Object.assign(this.headers,h);return this},end(){return this},redirect(n,url){this.code=n;this.headers.Location=url;return this}}}
test('Yahoo GUID falls back to authenticated Fantasy identity API',async()=>{env();const originalFetch=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.match(url,/fantasysports.yahooapis.com/);assert.equal(options.headers.Authorization,'Bearer sample-token');return {ok:true,json:async()=>({fantasy_content:{users:{'0':{user:[{guid:'fantasy-guid'}]}}}})}};try{assert.equal(await yahooAccountGuid({access_token:'sample-token'}),'fantasy-guid');assert.equal(await yahooAccountGuid({xoauth_yahoo_guid:'direct-guid'}),'direct-guid')}finally{globalThis.fetch=originalFetch}});
test('Yahoo GUID fallback fails closed when API denies access',async()=>{env();const old=globalThis.fetch;globalThis.fetch=async()=>({ok:false,status:403});try{await assert.rejects(yahooAccountGuid({access_token:'sample-token'}),YahooFantasyError)}finally{globalThis.fetch=old}});
test('encryption and tamper resistance',()=>{env();const s=seal({a:1});assert.deepEqual(unseal(s),{a:1});const encrypted=tokenEncrypt({refresh_token:'secret'});assert.deepEqual(tokenDecrypt(encrypted),{refresh_token:'secret'});const b=Buffer.from(encrypted,'base64url');b[b.length-1]^=1;assert.throws(()=>tokenDecrypt(b.toString('base64url')))});
test('opaque session identifiers and hashing',()=>{env();const a=sessionId(),b=sessionId();assert.notEqual(a,b);assert.equal(a.length,43);assert.equal(sessionHash(a).length,64);assert.notEqual(sessionHash(a),sessionHash(b))});
test('owner GUID fail closed',()=>{env();assert.equal(configured(),true);assert.equal(ownerGuid('test-owner-guid'),true);assert.equal(ownerGuid('other'),false);delete process.env.YAHOO_OWNER_GUID;assert.equal(configured(),true)});
test('setup rejects incorrect secret',()=>{env();const res=response();login({method:'POST',headers:{origin:'https://salarycaptain.vercel.app'},body:{setupCode:'wrong'}},res);assert.equal(res.code,403)});
test('setup accepts valid secret and records bootstrap intent',()=>{env();const res=response();login({method:'POST',headers:{origin:'https://salarycaptain.vercel.app'},body:{setupCode:'b'.repeat(40)}},res);assert.equal(res.code,302);const pending=unseal(decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=')[1]));assert.equal(pending.bootstrap,true)});
test('plain login routes to setup without minting OAuth state',()=>{env();const res=response();login({method:'GET',headers:{}},res);assert.equal(res.code,303);assert.equal(res.headers.Location,'/api/auth/yahoo/setup');assert.equal(res.headers['Set-Cookie'],undefined)});
test('setup uses explicit read scope, consent and PKCE',()=>{env();const res=response();login({method:'POST',headers:{origin:'https://salarycaptain.vercel.app'},body:{setupCode:'b'.repeat(40)}},res);assert.equal(res.code,302);const u=new URL(res.headers.Location);assert.equal(u.searchParams.get('redirect_uri'),redirect);assert.equal(u.searchParams.get('scope'),'fspt-r');assert.equal(u.searchParams.get('prompt'),'consent');const pending=unseal(decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=')[1]));assert.equal(pending.state,u.searchParams.get('state'));assert.equal(u.searchParams.get('code_challenge'),crypto.createHash('sha256').update(pending.verifier).digest('base64url'))});
test('callback refuses invalid state',async()=>{env();const res=response();await callback({method:'GET',headers:{},query:{code:'fake',state:'fake'}},res);assert.equal(res.code,400)});
test('mutating endpoints reject missing and foreign origin',async()=>{env();for(const origin of [undefined,'https://evil.example'])for(const handler of [refresh,logout]){const res=response();await handler({method:'POST',headers:origin?{origin}:{}},res);assert.equal(res.code,403)}});
process.on('exit',()=>{process.env=original});

function callbackRequest(intent={bootstrap:true}){
 const pending={state:'test-state',verifier:'test-verifier',at:Date.now(),...intent};
 return {method:'GET',headers:{cookie:'yahoo_oauth_pending='+encodeURIComponent(seal(pending))},query:{code:'test-code',state:pending.state}};
}
const fantasyIdentity={fantasy_content:{users:{'0':{user:[{guid:'private-guid'}]}}}};
const fantasyGame={fantasy_content:{game:[{game_key:'nba'}]}};
test('diagnostics distinguish identity denial without returning raw responses',async()=>{
 env();const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts)=>{
  calls.push(url);assert.equal(opts.headers.Authorization,'Bearer private-access-token');
  return url.includes('/game/')?new Response(JSON.stringify(fantasyGame)):
   new Response(JSON.stringify({error:{description:'This application is not authorized to perform this action.',access_token:'private-access-token',email:'private@example.com'}}),{status:403,headers:{'Content-Type':'application/json'}});
 };
 try{
  const result=await yahooAccessDiagnostics({access_token:'private-access-token'});
  assert.equal(result.game.ok,true);assert.equal(result.identity.category,'application_not_authorized');assert.equal(calls.length,2);
  assert.doesNotMatch(JSON.stringify(result),/private-access-token|private@example|description|guid/);
 }finally{globalThis.fetch=old}
});
test('missing scope in the authentication header is classified',async()=>{
 env();const old=globalThis.fetch;
 globalThis.fetch=async()=>new Response('',{status:401,headers:{'WWW-Authenticate':'OAuth oauth_problem="additional_authorization_required"'}});
 try{const result=await yahooAccessDiagnostics({access_token:'private-token'});assert.equal(result.game.category,'missing_scope');assert.equal(result.identity.category,'missing_scope')}finally{globalThis.fetch=old}
});
test('network, gateway and malformed successful responses remain distinct',async()=>{
 env();const old=globalThis.fetch;
 try{
  for(const [mock,category] of [
   [async()=>{throw Error('private network error with token')},'network_error'],
   [async()=>new Response('<html>Access denied</html>',{status:403,headers:{'Content-Type':'text/html'}}),'gateway_rejected'],
   [async()=>new Response('not json'),'invalid_json'],
   [async()=>new Response(JSON.stringify({fantasy_content:{}})),'missing_guid']
  ]){globalThis.fetch=mock;const result=await yahooAccessDiagnostics({access_token:'private-token'});assert.equal(result.identity.category,category)}
 }finally{globalThis.fetch=old}
});
test('diagnostic callback tests access without binding owners or saving sessions',async()=>{
 env();const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url)=>{
  calls.push(url);
  if(url.includes('/oauth2/get_token'))return new Response(JSON.stringify({access_token:'private-access-token',refresh_token:'private-refresh-token'}));
  assert.match(url,/fantasysports.yahooapis.com/);
  return new Response(JSON.stringify(url.includes('/game/')?fantasyGame:fantasyIdentity));
 };
 try{
  const res=response();await callback(callbackRequest({bootstrap:false,diagnostic:true}),res);
  assert.equal(res.code,200);assert.equal(res.body.fantasyAccess,true);assert.equal(calls.length,3);
  assert.doesNotMatch(JSON.stringify(res.body),/private-|refresh_token|access_token/);
  assert.equal(typeof res.headers['Set-Cookie'],'string');assert.doesNotMatch(res.headers['Set-Cookie'],/yahoo_session/);
 }finally{globalThis.fetch=old}
});
test('callback rejects missing setup intent before token exchange',async()=>{
 env();const old=globalThis.fetch;let fetched=false;globalThis.fetch=async()=>{fetched=true;throw Error('must not call')};
 try{const res=response();await callback(callbackRequest({bootstrap:false}),res);assert.equal(res.code,403);assert.equal(fetched,false)}finally{globalThis.fetch=old}
});
test('successful setup verifies owner and saves encrypted tokens',async()=>{
 env();const old=globalThis.fetch,calls=[];
 const hash=crypto.createHash('sha256').update('private-guid').digest('hex');
 globalThis.fetch=async(url,opts)=>{
  calls.push(url);
  if(url.includes('/oauth2/get_token'))return new Response(JSON.stringify({access_token:'private-access-token',refresh_token:'private-refresh-token',expires_in:3600}));
  if(url.includes('fantasysports.yahooapis.com'))return new Response(JSON.stringify(fantasyIdentity));
  if(url.includes('yahoo_oauth_owner'))return opts.method==='POST'?new Response(null,{status:204}):new Response(JSON.stringify([{guid_hash:hash}]));
  assert.match(url,/yahoo_oauth_sessions/);assert.equal(opts.method,'POST');
  const row=JSON.parse(opts.body);assert.doesNotMatch(opts.body,/private-access-token|private-refresh-token/);
  assert.equal(tokenDecrypt(row.token_ciphertext).refresh_token,'private-refresh-token');
  return new Response(null,{status:204});
 };
 try{
  const res=response();await callback(callbackRequest(),res);
  assert.equal(res.code,302);assert.equal(res.headers.Location,'/');assert.equal(calls.length,5);
  assert.ok(res.headers['Set-Cookie'].some(x=>x.startsWith('yahoo_session=')));
 }finally{globalThis.fetch=old}
});
test('scope failure never writes owner or session and exposes only safe checks',async()=>{
 env();const old=globalThis.fetch,calls=[];
 globalThis.fetch=async(url)=>{
  calls.push(url);
  if(url.includes('/oauth2/get_token'))return new Response(JSON.stringify({access_token:'private-token',refresh_token:'private-refresh'}));
  assert.match(url,/fantasysports.yahooapis.com/);
  return new Response('insufficient_scope private-token',{status:403});
 };
 try{const res=response();await callback(callbackRequest(),res);assert.equal(res.code,502);assert.equal(res.body.stage,'fantasy_access');assert.equal(res.body.checks.game.category,'missing_scope');assert.equal(calls.length,3);assert.doesNotMatch(JSON.stringify(res.body),/private-token|private-refresh/)}finally{globalThis.fetch=old}
});
