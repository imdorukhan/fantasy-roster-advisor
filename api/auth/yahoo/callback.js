import {saveSession,sessionId,storeConfigured,bindOwner} from './_store.js';
import {redirect,cookie,cookies,unseal,tokenRequest,configured,method,yahooAccountGuid,yahooAccessDiagnostics,YahooFantasyError} from './_lib.js';

export default async function handler(req,res){
 if(!method(req,res))return;
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('Set-Cookie',cookie('yahoo_oauth_pending','',0));
 if(!configured()||!storeConfigured())return res.status(503).json({error:'Yahoo OAuth is not configured'});
 if(req.query.error)return res.status(400).json({error:'Yahoo authorization declined or failed',help:'Restart from /api/auth/yahoo/setup'});
 let pending;
 try{pending=unseal(cookies(req).yahoo_oauth_pending||'')}catch{return res.status(400).json({error:'Invalid or expired OAuth state'})}
 if(!pending.state||pending.state!==req.query.state||!Number.isFinite(pending.at)||Date.now()-pending.at>600000||pending.at>Date.now()||!pending.verifier||typeof req.query.code!=='string')return res.status(400).json({error:'Invalid or expired OAuth state'});
 if(pending.bootstrap!==true&&pending.diagnostic!==true)return res.status(403).json({error:'Setup authorization expired or missing; restart setup',help:'Open /api/auth/yahoo/setup'});
 let stage='token_exchange';
 try{
  const token=await tokenRequest({grant_type:'authorization_code',code:req.query.code,redirect_uri:redirect,code_verifier:pending.verifier});
  if(!token.access_token||!token.refresh_token)throw Error('Yahoo response missing required tokens');
  stage='fantasy_access';
  if(pending.diagnostic===true){
   const checks=await yahooAccessDiagnostics(token);
   // Diagnostic consent never binds an owner or persists tokens or a session.
   return res.status(200).json({diagnostic:true,oauth:true,fantasyAccess:checks.game.ok&&checks.identity.ok,checks,next:'/api/auth/yahoo/setup'});
  }
  const guid=await yahooAccountGuid(token);
  stage='owner_binding';
  if(!await bindOwner(guid,true))return res.status(403).json({error:'Yahoo account is not the enrolled owner'});
  stage='session_save';
  const sid=sessionId();
  await saveSession(sid,{access_token:token.access_token,refresh_token:token.refresh_token,expires_at:Date.now()+(Number(token.expires_in)||3600)*1000});
  res.setHeader('Set-Cookie',[cookie('yahoo_oauth_pending','',0),cookie('yahoo_session',sid,2592000)]);
  return res.redirect(302,'/');
 }catch(e){
  if(e instanceof YahooFantasyError){
   console.error('Yahoo OAuth access check failed:',JSON.stringify(e.checks));
   return res.status(502).json({error:'Yahoo Fantasy access check failed',stage,checks:e.checks,help:'Compare game and identity checks before retrying setup.'});
  }
  const message=String(e?.message||'Unknown callback failure');
  const safe=/^(Yahoo token exchange failed: HTTP \d+|Yahoo Fantasy identity API did not return GUID|Owner store unavailable|Session store unavailable \(HTTP \d+\)|Yahoo response missing required tokens|Yahoo access token missing)$/.test(message)?message:'Unexpected OAuth callback failure';
  console.error('Yahoo OAuth callback stage failed:',stage,safe);
  return res.status(502).json({error:safe,stage,help:'Restart from /api/auth/yahoo/setup'});
 }
}
