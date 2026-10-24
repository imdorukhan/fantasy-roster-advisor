import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {seal,unseal,configured,redirect,ownerGuid} from './_lib.js';
import {tokenEncrypt,tokenDecrypt,sessionId,sessionHash} from './_store.js';
import login from './login.js';
import callback from './callback.js';
import logout from './logout.js';
import refresh from './refresh.js';
const original={...process.env};
function env(){process.env.YAHOO_SESSION_SECRET='a'.repeat(64);process.env.YAHOO_CLIENT_ID='test-id';process.env.YAHOO_CLIENT_SECRET='test-secret';process.env.YAHOO_OWNER_GUID='test-owner-guid'}
function response(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(x){this.body=x;return this},writeHead(n,h){this.code=n;Object.assign(this.headers,h);return this},end(){return this},redirect(n,url){this.code=n;this.headers.Location=url;return this}}}
test('encryption and tamper resistance',()=>{env();const s=seal({a:1});assert.deepEqual(unseal(s),{a:1});const encrypted=tokenEncrypt({refresh_token:'secret'});assert.deepEqual(tokenDecrypt(encrypted),{refresh_token:'secret'});const b=Buffer.from(encrypted,'base64url');b[b.length-1]^=1;assert.throws(()=>tokenDecrypt(b.toString('base64url')))});
test('opaque session identifiers and hashing',()=>{env();const a=sessionId(),b=sessionId();assert.notEqual(a,b);assert.equal(a.length,43);assert.equal(sessionHash(a).length,64);assert.notEqual(sessionHash(a),sessionHash(b))});
test('owner GUID fail closed',()=>{env();assert.equal(configured(),true);assert.equal(ownerGuid('test-owner-guid'),true);assert.equal(ownerGuid('other'),false);delete process.env.YAHOO_OWNER_GUID;assert.equal(configured(),false)});
test('redirect and PKCE',()=>{env();const res=response();login({method:'GET',headers:{}},res);assert.equal(res.code,302);const u=new URL(res.headers.Location);assert.equal(u.searchParams.get('redirect_uri'),redirect);const pending=unseal(decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=')[1]));assert.equal(pending.state,u.searchParams.get('state'));assert.equal(u.searchParams.get('code_challenge'),crypto.createHash('sha256').update(pending.verifier).digest('base64url'))});
test('callback refuses invalid state',async()=>{env();const res=response();await callback({method:'GET',headers:{},query:{code:'fake',state:'fake'}},res);assert.equal(res.code,400)});
test('mutating endpoints reject missing and foreign origin',async()=>{env();for(const origin of [undefined,'https://evil.example'])for(const handler of [refresh,logout]){const res=response();await handler({method:'POST',headers:origin?{origin}:{}},res);assert.equal(res.code,403)}});
process.on('exit',()=>{process.env=original});
