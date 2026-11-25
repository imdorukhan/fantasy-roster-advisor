import {stageWindow,stageGrantTimes} from './sc3-stage-window.mjs';
import {createPrivateKey,sign} from 'node:crypto';
export const CANONICAL='salarycaptain.vercel.app';
const path='/api/auto-data',approval='https://'+CANONICAL+path+'?sc3StageAuth=approve';
const noncePattern=/^[A-Za-z0-9_-]{43}$/;
const hostPattern=/^salarycaptain-[a-z0-9]+-dorukkosar-4371\.vercel\.app$/;
const deploymentPattern=/^dpl_[A-Za-z0-9]{15,64}$/;
const scope='sc3-acceptance-read-v1';
const epoch=()=>Math.floor(Date.now()/1000);
function exact(q,keys){return q&&Object.keys(q).length===keys.length&&keys.every(k=>Object.hasOwn(q,k)&&typeof q[k]==='string');}
function target(req,env){
 if(env.VERCEL_ENV!=='production'||env.SC3_STAGE_ISSUER!=='1'||env.SC3_ISOLATED==='1'||env.SC3_STAGE_RECEIVER==='1'||env.SC3_SHARED_DB!=='1'||env.SC3_PRODUCTION_READS!=='1'||req.headers?.host!==CANONICAL)return null;
 const audience=env.SC3_STAGE_TARGET_HOST,id=env.SC3_STAGE_TARGET_DEPLOYMENT_ID;
 return hostPattern.test(audience??'')&&deploymentPattern.test(id??'')?{audience,id}:null;
}
function signingKey(raw){
 if(typeof raw!=='string'||raw.length>512||!/^[A-Za-z0-9+/]+={0,2}$/.test(raw))throw Error('Signing key unavailable');
 const key=createPrivateKey({key:Buffer.from(raw,'base64'),format:'der',type:'pkcs8'});
 if(key.asymmetricKeyType!=='ed25519')throw Error('Unexpected signing key');
 return key;
}
function mint(t,challenge,env,at,w){
 if(!Number.isSafeInteger(at)||at<0)throw Error('Invalid clock');
 const payload={v:2,iss:CANONICAL,aud:t.audience,dpl:t.id,scope,nonce:challenge,...stageGrantTimes(w,at)};
 const body=Buffer.from(JSON.stringify(payload)).toString('base64url');
 return body+'.'+sign(null,Buffer.from(body),signingKey(env.SC3_STAGE_SIGNING_KEY)).toString('base64url');
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
function html(res,title,body,action){
 headers(res,action);
 res.setHeader('Content-Type','text/html; charset=utf-8');
 return res.status(200).send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+'</title><h1>'+esc(title)+'</h1>'+body+'</html>');
}
function form(action,name,value,label){return '<form method="post" action="'+esc(action)+'"><input type="hidden" name="'+esc(name)+'" value="'+esc(value)+'"><button type="submit">'+esc(label)+'</button></form>';}
function bodyChallenge(req){
 if(!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers?.['content-type']??'')))return null;
 const b=req.body;
 if(typeof b==='string'||Buffer.isBuffer(b)){
  if(Buffer.byteLength(b)>256)return null;
  const q=new URLSearchParams(String(b));
  return [...q.keys()].length===1&&q.has('challenge')?q.get('challenge'):null;
 }
 return exact(b,['challenge'])?b.challenge:null;
}
const error=(res,status,message)=>res.status(status).json({error:message});
// Issuer-only: no receiver, no session minting or authorization bypass.
// Owner verifier is the existing production metadata-only session verifier.
export async function stageIssuer(req,res,{env=process.env,owner=async()=>false,now=epoch}={}){
 headers(res);
 const q=req.query??{};
 if(String(req.url??'').split('?')[0]!==path||!exact(q,req.method==='GET'?['sc3StageAuth','challenge']:['sc3StageAuth'])||q.sc3StageAuth!=='approve')return error(res,400,'Invalid staging approval request');
 const t=target(req,env);if(!t||!stageWindow(env,now()))return error(res,404,'Staging issuer disabled');
 if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return error(res,405,'Method not allowed');}
 if(req.method==='POST'&&(req.headers?.origin!=='https://'+CANONICAL||req.headers?.['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin'))return error(res,403,'Invalid approval origin');
 const challenge=req.method==='GET'?q.challenge:bodyChallenge(req);
 if(!noncePattern.test(challenge??''))return error(res,400,'Invalid challenge');
 try{
  if(!await owner(req))return error(res,401,'Yahoo owner sign-in required');
  const at=now(),w=stageWindow(env,at);if(!w)return error(res,404,'Staging issuer disabled');
  if(req.method==='GET'){
   return html(res,'Approve staged acceptance','<p>Approve up to five minutes of read-only acceptance for '+esc(t.audience)+' ('+esc(t.id)+'). No fantasy transactions or writer access.</p>'+form(approval,'challenge',challenge,'Approve read-only access'),'https://'+CANONICAL);
  }
  const grant=mint(t,challenge,env,at,w);
  return html(res,'Complete staged acceptance','<p>Grant must be transferred within one minute or before the release window closes. It does not contain your Yahoo session.</p>'+form('https://'+t.audience+path+'?sc3StageAuth=exchange','grant',grant,'Open staged acceptance'),'https://'+t.audience);
 }catch{return error(res,503,'Staging approval unavailable');}
}
