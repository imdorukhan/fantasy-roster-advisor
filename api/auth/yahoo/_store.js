import crypto from 'node:crypto';
import {key,authConfig} from './_lib.js';
import {withScopedTransaction} from '../../../sc3-postgres.mjs';
const scoped=()=>authConfig().shared===true;
const tx=(fn,readOnly=true)=>withScopedTransaction(fn,{readOnly});
const TABLE='yahoo_oauth_sessions';
export function tokenEncrypt(data){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);const bytes=Buffer.concat([c.update(JSON.stringify(data)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),bytes]).toString('base64url')}
export function tokenDecrypt(value){const b=Buffer.from(value,'base64url');if(b.length<29)throw Error('Invalid token ciphertext');const d=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString())}
export function sessionId(){return crypto.randomBytes(32).toString('base64url')}
export function sessionHash(id){return crypto.createHash('sha256').update(id).digest('hex')}
function settings(){const {url,secret}=authConfig();if(!url||!secret)throw Error('Salary CAPtain private database is not configured');const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.supabase.co'))throw Error('Invalid Supabase URL');return {url:u.origin,secret}}
async function request(path,{method='GET',body,prefer}={}){const {url,secret}=settings();const r=await fetch(url+'/rest/v1/'+TABLE+path,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Session store unavailable (HTTP '+r.status+')');if(r.status===204||prefer?.includes('return=minimal'))return null;return r.json()}
export async function saveSession(id,tokens){const hash=sessionHash(id);if(scoped())return tx(c=>c.query('insert into sc3.yahoo_oauth_sessions(session_hash,token_ciphertext,expires_at) values($1,$2,$3) on conflict(session_hash) do update set token_ciphertext=excluded.token_ciphertext,expires_at=excluded.expires_at',[hash,tokenEncrypt(tokens),new Date(Date.now()+30*86400000)]),false);await request('?on_conflict=session_hash',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{session_hash:hash,token_ciphertext:tokenEncrypt(tokens),expires_at:new Date(Date.now()+30*86400000).toISOString()}})}
export async function loadSession(id){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(id))return null;if(scoped()){const rows=await tx(async c=>(await c.query('select token_ciphertext from sc3.yahoo_oauth_sessions where session_hash=$1 and expires_at>now()',[sessionHash(id)])).rows);return rows[0]?tokenDecrypt(rows[0].token_ciphertext):null}const rows=await request('?session_hash=eq.'+sessionHash(id)+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=token_ciphertext&limit=1');return rows?.[0]?tokenDecrypt(rows[0].token_ciphertext):null}
export async function deleteSession(id){if(typeof id==='string'&&/^[A-Za-z0-9_-]{43}$/.test(id)){if(scoped())return tx(c=>c.query('delete from sc3.yahoo_oauth_sessions where session_hash=$1',[sessionHash(id)]),false);await request('?session_hash=eq.'+sessionHash(id),{method:'DELETE',prefer:'return=minimal'})}}
export function storeConfigured(){try{if(!scoped())settings();return true}catch{return false}}

export async function bindOwner(guid,allowInitialBind=false){if(typeof guid!=='string'||!guid)return false;const hash=crypto.createHash('sha256').update(guid).digest('hex');if(scoped())return tx(async c=>{if(allowInitialBind)await c.query('insert into sc3.yahoo_oauth_owner(singleton,guid_hash) values(true,$1) on conflict(singleton) do nothing',[hash]);const {rows}=await c.query('select guid_hash from sc3.yahoo_oauth_owner where singleton=true');return rows[0]?.guid_hash===hash},!allowInitialBind);if(allowInitialBind){await requestOwner('?on_conflict=singleton',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{singleton:true,guid_hash:hash}})}const rows=await requestOwner('?singleton=eq.true&select=guid_hash&limit=1');return rows?.[0]?.guid_hash===hash}
async function requestOwner(path,opts={}){const {url,secret}=settings();const r=await fetch(url+'/rest/v1/yahoo_oauth_owner'+path,{method:opts.method||'GET',headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',...(opts.prefer?{Prefer:opts.prefer}:{})},body:opts.body?JSON.stringify(opts.body):undefined,signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Owner store unavailable');if(r.status===204||opts.prefer?.includes('return=minimal'))return null;return r.json()}

const ALLOWED_SECTIONS=new Set(['settings','teams','standings','scoreboard','roster']);
async function leagueRequest(table,query='',{method='GET',body,prefer}={}){
 const {url,secret}=settings();
 const response=await fetch(url+'/rest/v1/'+table+query,{method,headers:{apikey:secret,Authorization:'Bearer '+secret,'Content-Type':'application/json',...(prefer?{Prefer:prefer}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('League database HTTP '+response.status);
 if(response.status===204||prefer?.includes('return=minimal'))return null;
 return response.json();
}
export async function loadLeagueSnapshots(leagueId=85892){
 const rows=scoped()?await tx(async c=>(await c.query('select section,payload,observed_at,source from sc3.yahoo_league_snapshots where league_id=$1',[Number(leagueId)])).rows):await leagueRequest('yahoo_league_snapshots','?league_id=eq.'+Number(leagueId)+'&select=section,payload,observed_at,source');
 return Object.fromEntries(rows.filter(r=>ALLOWED_SECTIONS.has(r.section)).map(r=>[r.section,r]));
}
export async function saveLeagueSnapshots(leagueId,sections){
 const observed_at=new Date().toISOString();
 const rows=Object.entries(sections).filter(([k,v])=>ALLOWED_SECTIONS.has(k)&&v&&typeof v==='object').map(([section,payload])=>({league_id:leagueId,section,payload,observed_at,source:'Yahoo Fantasy Sports API'}));
 if(!rows.length)return 0;
 if(scoped())return tx(async c=>{for(const r of rows){await c.query('insert into sc3.yahoo_league_snapshots(league_id,section,payload,observed_at,source) values($1,$2,$3,$4,$5) on conflict(league_id,section) do update set payload=excluded.payload,observed_at=excluded.observed_at,source=excluded.source where sc3.yahoo_league_snapshots.observed_at<=excluded.observed_at',[r.league_id,r.section,r.payload,r.observed_at,r.source]);await c.query('insert into sc3.yahoo_league_snapshot_history(league_id,section,payload,observed_at) values($1,$2,$3,$4)',[r.league_id,r.section,r.payload,r.observed_at]);}return rows.length},false);
 await leagueRequest('yahoo_league_snapshots','?on_conflict=league_id,section',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:rows});
 // History is best-effort: a successful current snapshot must not be lost to a history insert failure.
 try{await leagueRequest('yahoo_league_snapshot_history','',{method:'POST',prefer:'return=minimal',body:rows.map(({league_id,section,payload,observed_at})=>({league_id,section,payload,observed_at}))})}catch(e){console.error('League history write failed:',e.message)}
 return rows.length;
}

export async function loadBackgroundYahooSession(){
 // Owner-bound application: never return the ciphertext or tokens to clients.
 const rows=scoped()?await tx(async c=>(await c.query('select session_hash,token_ciphertext from sc3.yahoo_oauth_sessions where expires_at>now() order by expires_at desc limit 1')).rows):await request('?expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=session_hash,token_ciphertext&order=expires_at.desc&limit=1');
 if(!rows?.[0])return null;
 return {hash:rows[0].session_hash,tokens:tokenDecrypt(rows[0].token_ciphertext)};
}
export async function updateBackgroundYahooSession(hash,tokens){
 if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid session reference');
 if(scoped())return tx(c=>c.query('update sc3.yahoo_oauth_sessions set token_ciphertext=$2,expires_at=$3 where session_hash=$1',[hash,tokenEncrypt(tokens),new Date(Date.now()+30*86400000)]),false);
 await request('?session_hash=eq.'+hash,{method:'PATCH',prefer:'return=minimal',body:{token_ciphertext:tokenEncrypt(tokens),expires_at:new Date(Date.now()+30*86400000).toISOString()}});
}
