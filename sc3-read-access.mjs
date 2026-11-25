import {hasProductionOwnerSession} from './api/auth/yahoo/_store.js';
import {hasStageRead} from './sc3-stage-auth.mjs';
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
 if(hasStageRead(req,env))return true;
 if(env.SC3_STAGE_RECEIVER==='1'&&req.headers?.host===env.VERCEL_URL&&env.VERCEL_URL!=='salarycaptain.vercel.app'){
  res.status(401).json({error:'Active staging grant required'});return false;
 }
 try{
  if(await verifyProductionOwner(req,{verify}))return true;
 }catch{
  res.status(503).json({error:'Owner session verification unavailable'});
  return false;
 }
 res.status(401).json({error:'Yahoo owner sign-in required'});
 return false;
}

// Original canonical owner verification; no staged grant or Preview bypass.
export async function verifyProductionOwner(req,{verify=hasProductionOwnerSession}={}){
 const sessions=typeof req.headers?.cookie==='string'?req.headers.cookie.split(';').map(value=>value.trim()).filter(value=>value.startsWith('yahoo_session=')):[];
 const sid=sessions.length===1?sessions[0].slice('yahoo_session='.length):'';
 return /^[A-Za-z0-9_-]{43}$/.test(sid)&&await verify(sid);
}
