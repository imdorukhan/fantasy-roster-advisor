import {hasProductionOwnerSession} from './api/auth/yahoo/_store.js';
import {bridgeEnabled,sc3ProductionEnabled} from './sc3-yahoo-bridge.mjs';

export async function requireSc3Read(req,res,{env=process.env,verify=hasProductionOwnerSession}={}){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET'){
  res.setHeader('Allow','GET');
  res.status(405).json({error:'Method not allowed'});
  return false;
 }
 if(bridgeEnabled(env))return true; // The existing preview relies on Vercel Deployment Protection.
 if(!sc3ProductionEnabled(env)){
  res.status(404).json({error:'Not found'});
  return false;
 }
 const sessions=typeof req.headers?.cookie==='string'?req.headers.cookie.split(';').map(value=>value.trim()).filter(value=>value.startsWith('yahoo_session=')):[];
 const sid=sessions.length===1?sessions[0].slice('yahoo_session='.length):'';
 try{
  if(/^[A-Za-z0-9_-]{43}$/.test(sid)&&await verify(sid))return true;
 }catch{
  res.status(503).json({error:'Owner session verification unavailable'});
  return false;
 }
 res.status(401).json({error:'Yahoo owner sign-in required'});
 return false;
}
