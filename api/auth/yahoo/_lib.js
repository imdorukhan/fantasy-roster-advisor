import crypto from 'node:crypto';
export const redirect='https://salarycaptain.vercel.app/api/auth/yahoo/callback';
export const cookie=(name,value,age=600)=>`${name}=${encodeURIComponent(value)}; Path=/api/auth/yahoo; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
export function key(){const s=process.env.YAHOO_SESSION_SECRET;if(!s||s.length<32)throw Error('YAHOO_SESSION_SECRET must be at least 32 characters');return crypto.createHash('sha256').update(s).digest()}
export function seal(data){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv),body=Buffer.concat([c.update(JSON.stringify(data)),c.final()]);return Buffer.concat([iv,c.getAuthTag(),body]).toString('base64url')}
export function unseal(value){const b=Buffer.from(value,'base64url'),d=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString())}
export function cookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(a=>a.length===2).map(([k,v])=>[k,decodeURIComponent(v)]))}
export function configured(){return Boolean(process.env.YAHOO_CLIENT_ID&&process.env.YAHOO_CLIENT_SECRET&&process.env.YAHOO_SESSION_SECRET?.length>=32)}
export function ownerGuid(guid){const expected=process.env.YAHOO_OWNER_GUID;return typeof guid==='string'&&typeof expected==='string'&&expected.length>0&&guid.length===expected.length&&crypto.timingSafeEqual(Buffer.from(guid),Buffer.from(expected))}
export async function tokenRequest(params){const id=process.env.YAHOO_CLIENT_ID,secret=process.env.YAHOO_CLIENT_SECRET;if(!id||!secret)throw Error('Yahoo credentials missing');const r=await fetch('https://api.login.yahoo.com/oauth2/get_token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+Buffer.from(id+':'+secret).toString('base64')},body:new URLSearchParams(params),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('Yahoo token exchange failed: HTTP '+r.status);return r.json()}
export function method(req,res){if(req.method!=='GET'){res.setHeader('Allow','GET');res.status(405).end();return false}res.setHeader('Cache-Control','no-store');return true}

const FANTASY_BASE='https://fantasysports.yahooapis.com/fantasy/v2/';
const IDENTITY_PATH='users;use_login=1?format=json';
const GAME_PATH='game/nba/metadata?format=json';

// Only fixed classifications leave this module; raw responses may echo tokens.
function denialCategory(text,contentType){
 if(/additional_authorization_required|insufficient_scope|appropriate OAuth scope|invalid_scope/i.test(text))return 'missing_scope';
 if(/invalid_token|token_expired|expired token|token_rejected/i.test(text))return 'invalid_token';
 if(/application is not authorized to perform this action/i.test(text))return 'application_not_authorized';
 if(/text\/html/i.test(contentType))return 'gateway_rejected';
 return 'upstream_rejected';
}

async function fantasyRead(accessToken,path){
 let r;
 try{
  r=await fetch(FANTASY_BASE+path,{headers:{Authorization:'Bearer '+accessToken,Accept:'application/json','User-Agent':'SalaryCAPtain/1.0 (read-only Fantasy client)'},signal:AbortSignal.timeout(10000)});
 }catch{return {check:{ok:false,status:null,category:'network_error'}}}
 if(!r.ok){
  let text='';try{text=(await r.text()).slice(0,8192)}catch{}
  const header=r.headers?.get?.('www-authenticate')||'';
  return {check:{ok:false,status:r.status,category:denialCategory(text+' '+header,r.headers?.get?.('content-type')||'')}};
 }
 try{
  const data=await r.json();
  if(!data?.fantasy_content)return {check:{ok:false,status:r.status,category:'unexpected_response'}};
  return {check:{ok:true,status:r.status,category:'ok'},data};
 }catch{return {check:{ok:false,status:r.status,category:'invalid_json'}}}
}

export class YahooFantasyError extends Error{
 constructor(checks){super('Yahoo Fantasy access check failed');this.checks=checks}
}

export async function yahooAccessDiagnostics(token){
 if(typeof token?.access_token!=='string'||!token.access_token)throw Error('Yahoo access token missing');
 const game=await fantasyRead(token.access_token,GAME_PATH);
 const identity=await fantasyRead(token.access_token,IDENTITY_PATH);
 const guid=identity.data?.fantasy_content?.users?.['0']?.user?.[0]?.guid;
 if(identity.check.ok&&(typeof guid!=='string'||!guid))identity.check={ok:false,status:identity.check.status,category:'missing_guid'};
 return {game:game.check,identity:identity.check};
}

export async function yahooAccountGuid(token){
 if(typeof token?.xoauth_yahoo_guid==='string'&&token.xoauth_yahoo_guid)return token.xoauth_yahoo_guid;
 if(typeof token?.access_token!=='string'||!token.access_token)throw Error('Yahoo access token missing');
 const identity=await fantasyRead(token.access_token,IDENTITY_PATH);
 if(!identity.check.ok){
  const game=await fantasyRead(token.access_token,GAME_PATH);
  throw new YahooFantasyError({identity:identity.check,game:game.check});
 }
 const guid=identity.data?.fantasy_content?.users?.['0']?.user?.[0]?.guid;
 if(typeof guid!=='string'||!guid)throw Error('Yahoo Fantasy identity API did not return GUID');
 return guid;
}
