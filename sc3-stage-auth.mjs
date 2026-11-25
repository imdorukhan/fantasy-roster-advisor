import {stageWindow,stageGrantTimes} from './sc3-stage-window.mjs';
import {createHash,createPrivateKey,createPublicKey,randomBytes,sign,verify,timingSafeEqual} from 'node:crypto';
export const CANONICAL='salarycaptain.vercel.app';
const path='/api/auto-data';
const pending='__Host-sc3_stage_pending',binding='__Host-sc3_stage_binding',session='__Host-sc3_stage_grant';
const SCOPE='sc3-acceptance-read-v1';
const noncePattern=/^[A-Za-z0-9_-]{43}$/;
const hostPattern=/^salarycaptain-[a-z0-9]+-dorukkosar-4371\.vercel\.app$/;
const deploymentPattern=/^dpl_[A-Za-z0-9]{15,64}$/;
const epoch=()=>Math.floor(Date.now()/1000);
const hash=v=>createHash('sha256').update(v).digest('base64url');
const host=req=>req.headers?.host;
const origin=h=>'https://'+h;
const url=(h,action)=>origin(h)+path+'?sc3StageAuth='+action;
function exactQuery(q,keys){
 return q&&Object.keys(q).length===keys.length&&keys.every(k=>Object.hasOwn(q,k)&&typeof q[k]==='string');
}
function cookieValue(req,name){
 const entries=String(req.headers?.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(name+'='));
 return entries.length===1?entries[0].slice(name.length+1):'';
}
function setCookie(name,value,maxAge,sameSite='Lax'){
 return name+'='+value+'; Path=/; Secure; HttpOnly; SameSite='+sameSite+'; Max-Age='+maxAge;
}
function keyFrom(raw,privateKey=false){
 if(typeof raw!=='string'||raw.length>512||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))throw Error('Stage key unavailable');
 const opts={key:Buffer.from(raw,'base64'),format:'der',type:privateKey?'pkcs8':'spki'};
 const key=privateKey?createPrivateKey(opts):createPublicKey(opts);
 if(key.asymmetricKeyType!=='ed25519')throw Error('Unexpected stage key');
 return key;
}
function receiver(req,env){
 if(env.SC3_STAGE_RECEIVER!=='1'||env.VERCEL_ENV!=='production'||env.SC3_SHARED_DB!=='1'||env.SC3_PRODUCTION_READS!=='1'||env.SC3_ISOLATED==='1'||env.SC3_STAGE_ISSUER==='1'||env.SC3_STAGE_SIGNING_KEY)return null;
 const audience=env.VERCEL_URL,id=env.VERCEL_DEPLOYMENT_ID;
 if(!hostPattern.test(audience??'')||!deploymentPattern.test(id??'')||host(req)!==audience)return null;
 return {audience,id};
}
function issuer(req,env){
 if(env.SC3_STAGE_ISSUER!=='1'||env.VERCEL_ENV!=='production'||env.SC3_ISOLATED==='1'||env.SC3_STAGE_RECEIVER==='1'||env.SC3_SHARED_DB!=='1'||env.SC3_PRODUCTION_READS!=='1'||host(req)!==CANONICAL)return null;
 const audience=env.SC3_STAGE_TARGET_HOST,id=env.SC3_STAGE_TARGET_DEPLOYMENT_ID;
 return hostPattern.test(audience??'')&&deploymentPattern.test(id??'')?{audience,id}:null;
}
export function allowedStageRead(req){
 if(req.method!=='GET'||String(req.url??'').split('?')[0]!==path)return false;
 const q=req.query;
 if(!q)return false;
 const one=k=>exactQuery(q,[k])&&q[k]==='1';
 if(['sc3LeagueRosters','sc3P2Lab'].some(one))return true;
 if(exactQuery(q,['sc3MatchupLineups','projection','forecast']))return q.sc3MatchupLineups==='1'&&q.projection==='1'&&q.forecast==='1';
 if(exactQuery(q,['sc3MatchupLineups','projection']))return q.sc3MatchupLineups==='1'&&q.projection==='1';
 if(one('sc3MatchupLineups'))return true;
 if(exactQuery(q,['sc3Streaming','waiverImpact']))return q.sc3Streaming==='1'&&q.waiverImpact==='1';
 if(one('sc3Streaming'))return true;
 if(exactQuery(q,['live','officialMatchup']))return q.live==='1'&&q.officialMatchup==='1';
 if(exactQuery(q,['sc3Player','id'])||exactQuery(q,['sc3Player','id','dropId']))return q.sc3Player==='1'&&/^\d{1,10}$/.test(q.id)&&(q.dropId===undefined||/^\d{1,10}$/.test(q.dropId));
 return false;
}
function mint(target,digest,env,now,w){
 const payload={v:2,iss:CANONICAL,aud:target.audience,dpl:target.id,scope:SCOPE,nonce:digest,...stageGrantTimes(w,now)};
 const data=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return data+'.'+sign(null,Buffer.from(data),keyFrom(env.SC3_STAGE_SIGNING_KEY,true)).toString('base64url');
}
function claims(grant,target,proof,env,now,{exchange=false}={}){
 try{
  if(typeof grant!=='string'||grant.length>1800||!noncePattern.test(proof))return null;
  const bits=grant.split('.');
  if(bits.length!==2||!bits.every(x=>/^[A-Za-z0-9_-]+$/.test(x)))return null;
  if(!verify(null,Buffer.from(bits[0]),keyFrom(env.SC3_STAGE_VERIFY_KEY),Buffer.from(bits[1],'base64url')))return null;
  const p=JSON.parse(Buffer.from(bits[0],'base64url').toString('utf8'));
  const w=stageWindow(env,now);if(!w)return null;
  const expected=stageGrantTimes(w,p.iat);
  if(p.v!==2||p.windowStart!==w.start||p.windowEnd!==w.end||p.iat<w.start||p.iss!==CANONICAL||p.aud!==target.audience||p.dpl!==target.id||p.scope!==SCOPE||!Number.isSafeInteger(p.iat)||!Number.isSafeInteger(p.exp)||!Number.isSafeInteger(p.handoff)||p.exp!==expected.exp||p.handoff!==expected.handoff||p.iat>now||p.exp<=now||exchange&&p.handoff<=now||!noncePattern.test(p.nonce))return null;
  if(!timingSafeEqual(Buffer.from(p.nonce),Buffer.from(hash(proof))))return null;
  return p;
 }catch{return null;}
}
// Reject same-site sibling origins as well as cross-site requests. Older browsers
// may omit Fetch Metadata; the existing signed capability and proof still apply.
function localNavigation(req){const site=req.headers?.['sec-fetch-site'];return site===undefined||site==='same-origin'||site==='none';}
function sessionClaims(req,env,now){
 const target=receiver(req,env);
 if(!target||!localNavigation(req))return null;
 return claims(cookieValue(req,session),target,cookieValue(req,binding),env,now);
}
export function hasStageRead(req,env=process.env,now=epoch()){
 return allowedStageRead(req)&&!!sessionClaims(req,env,now);
}
const esc=s=>String(s).replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function headers(res,formAction="'none'"){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Referrer-Policy','strict-origin');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Cross-Origin-Opener-Policy','same-origin');
 res.setHeader('Content-Security-Policy',"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action "+formAction);
}
function html(res,title,body,formAction){
 headers(res,formAction);
 res.setHeader('Content-Type','text/html; charset=utf-8');
 return res.status(200).send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><h1>'+esc(title)+'</h1>'+body+'</html>');
}
function form(action,name,value,label){
 return '<form method="post" action="'+esc(action)+'"><input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'"><button type="submit">'+esc(label)+'</button></form>';
}
function bodyField(req,key){
 if(!String(req.headers?.['content-type']??'').toLowerCase().startsWith('application/x-www-form-urlencoded'))return null;
 const b=req.body;
 if(typeof b==='string'||Buffer.isBuffer(b)){
  const s=String(b);if(s.length>2200)return null;
  const p=new URLSearchParams(s);return [...p.keys()].length===1&&p.has(key)?p.get(key):null;
 }
 return exactQuery(b,[key])&&b[key].length<=1800?b[key]:null;
}
function error(res,status,message){return res.status(status).json({error:message});}
// Explicit owner approval on canonical, form POST to the fixed deployment,
// browser-generated proof cookie bound to the signature. No Yahoo session ID,
// token, GUID, or other credential is ever included in the grant.
export async function stageAuth(req,res,{env=process.env,owner=async()=>false,now=epoch,random=()=>randomBytes(32).toString('base64url')}={}){
 headers(res);
 const q=req.query??{},action=q.sc3StageAuth;
 if(String(req.url??'').split('?')[0]!==path||!exactQuery(q,action==='approve'&&req.method==='GET'?['sc3StageAuth','challenge']:['sc3StageAuth']))return error(res,400,'Invalid staging request');
 const target=receiver(req,env),iss=issuer(req,env);
 const atStart=now(),window=stageWindow(env,atStart);
 if((!target&&!iss)||!window)return error(res,404,'Staging authorization disabled');
 if(action==='begin'&&target&&req.method==='GET'){
  if(!localNavigation(req))return error(res,403,'Invalid start origin');
  const proof=random();if(!noncePattern.test(proof))return error(res,503,'Staging unavailable');
  try{keyFrom(env.SC3_STAGE_VERIFY_KEY)}catch{return error(res,503,'Staging key unavailable')}
  res.setHeader('Set-Cookie',[setCookie(pending,proof,Math.min(300,window.end-atStart),'None'),setCookie(binding,'',0),setCookie(session,'',0)]);
  const challenge=hash(proof);
  return html(res,'Staged acceptance','<p>Read-only access for this exact deployment. Continue to canonical owner approval.</p><p><a href="'+esc(url(CANONICAL,'approve')+'&challenge='+challenge)+'">Continue to owner approval</a></p>');
 }
 if(action==='approve'&&iss){
  if(req.method==='GET'){
   if(!noncePattern.test(q.challenge))return error(res,400,'Invalid challenge');
   return html(res,'Approve staged acceptance','<p>Approve up to five minutes of read-only acceptance for '+esc(iss.audience)+' ('+esc(iss.id)+'). No fantasy transactions or writer access.</p>'+form(url(CANONICAL,'approve'),'challenge',q.challenge,'Approve read-only access'),origin(CANONICAL));
  }
  if(req.method==='POST'){
   if(req.headers?.origin!==origin(CANONICAL)||req.headers?.['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')return error(res,403,'Invalid approval origin');
   const challenge=bodyField(req,'challenge');if(!noncePattern.test(challenge??''))return error(res,400,'Invalid challenge');
   try{if(!await owner(req))return error(res,401,'Yahoo owner sign-in required');
    const at=now(),w=stageWindow(env,at);if(!w)return error(res,404,'Staging authorization disabled');
    const grant=mint(iss,challenge,env,at,w);
    return html(res,'Complete staged acceptance','<p>Grant must be transferred within one minute or before the release window closes. It does not contain your Yahoo session.</p>'+form(url(iss.audience,'exchange'),'grant',grant,'Open staged acceptance'),origin(iss.audience));
   }catch{return error(res,503,'Staging approval unavailable')}
  }
 }
 if(action==='exchange'&&target&&req.method==='POST'){
  const mode=req.headers?.['sec-fetch-mode'],dest=req.headers?.['sec-fetch-dest'];
  if(req.headers?.origin!==origin(CANONICAL)||mode!==undefined&&mode!=='navigate'||dest!==undefined&&dest!=='document')return error(res,403,'Invalid transfer origin');
  const grant=bodyField(req,'grant'),proof=cookieValue(req,pending),at=now();
  const p=claims(grant,target,proof,env,at,{exchange:true});
  if(!p)return error(res,401,'Invalid or expired staging grant');
  const lifetime=p.exp-at;
  res.setHeader('Set-Cookie',[setCookie(pending,'',0,'None'),setCookie(binding,proof,lifetime),setCookie(session,grant,lifetime)]);
  // A redirect preserves the cross-site Fetch Metadata taint. Commit a new
  // staged document instead; the explicit link initiates a same-origin GET.
  // No grant, proof, or owner metadata is reflected into the landing body.
  return html(res,'Staged acceptance transfer received','<p>Continue to verify your short-lived read-only access.</p><p><a href="'+esc(url(target.audience,'status'))+'">Continue to staged status</a></p>');
 }
 if(action==='status'&&target&&req.method==='GET'){
  const p=sessionClaims(req,env,now());if(!p)return error(res,401,'Staging grant required');
  return res.status(200).json({mode:'SC3_STAGED_ACCEPTANCE',deploymentId:target.id,expiresAt:new Date(p.exp*1000).toISOString(),windowEndsAt:new Date(p.windowEnd*1000).toISOString(),readOnly:true,checks:['sc3LeagueRosters=1','live=1&officialMatchup=1','sc3Streaming=1&waiverImpact=1','sc3MatchupLineups=1&projection=1&forecast=1','sc3P2Lab=1']});
 }
 if(action==='clear'&&target&&req.method==='POST'){
  if(req.headers?.origin!==origin(target.audience)||!localNavigation(req))return error(res,403,'Invalid clear origin');
  res.setHeader('Set-Cookie',[setCookie(pending,'',0,'None'),setCookie(binding,'',0),setCookie(session,'',0)]);
  return res.status(200).json({cleared:true});
 }
 return error(res,405,'Staging operation not allowed');
}
