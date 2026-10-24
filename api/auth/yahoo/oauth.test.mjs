import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {seal,unseal,cookie,configured,redirect} from './_lib.js';
import login from './login.js';
import callback from './callback.js';
import status from './status.js';
const original={...process.env};
function env(){process.env.YAHOO_SESSION_SECRET='a'.repeat(64);process.env.YAHOO_CLIENT_ID='test-id';process.env.YAHOO_CLIENT_SECRET='test-secret'}
function response(){return {headers:{},code:200,setHeader(k,v){this.headers[k]=v;return this},status(n){this.code=n;return this},json(x){this.body=x;return this},writeHead(n,h){this.code=n;Object.assign(this.headers,h);return this},end(){return this},redirect(n,url){this.code=n;this.headers.Location=url;return this}}}
test('encrypted session roundtrip and tamper detection',()=>{env();const s=seal({refresh_token:'secret'});assert.deepEqual(unseal(s),{refresh_token:'secret'});const b=Buffer.from(s,'base64url');b[b.length-1]^=1;assert.throws(()=>unseal(b.toString('base64url')));assert.match(cookie('test','value'),/HttpOnly; Secure; SameSite=Lax/)});
test('configuration and redirect',()=>{env();assert.equal(configured(),true);assert.equal(redirect,'https://salarycaptain.vercel.app/api/auth/yahoo/callback')});
test('login issues state and PKCE challenge',()=>{env();const res=response();login({method:'GET',headers:{}},res);assert.equal(res.code,302);const u=new URL(res.headers.Location);assert.equal(u.searchParams.get('redirect_uri'),redirect);assert.equal(u.searchParams.get('code_challenge_method'),'S256');const pending=unseal(decodeURIComponent(res.headers['Set-Cookie'].split(';')[0].split('=')[1]));assert.equal(pending.state,u.searchParams.get('state'));assert.equal(u.searchParams.get('code_challenge'),crypto.createHash('sha256').update(pending.verifier).digest('base64url'))});
test('callback rejects missing state without token exchange',async()=>{env();const res=response();await callback({method:'GET',headers:{},query:{code:'fake',state:'fake'}},res);assert.equal(res.code,400)});
test('status does not disclose token',()=>{env();const res=response();status({method:'GET',headers:{cookie:'yahoo_session='+encodeURIComponent(seal({refresh_token:'secret',expires_at:Date.now()+10000}))}},res);assert.deepEqual(res.body,{configured:true,connected:true,accessTokenExpired:false});assert.equal(JSON.stringify(res.body).includes('secret'),false)});
process.on('exit',()=>{process.env=original});
