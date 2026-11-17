// Authenticated read-only visibility into Yahoo Supabase snapshot health.
// Never expose OAuth tokens, cached payloads or owner identifiers.
import {cookies,configured} from './auth/yahoo/_lib.js';
import {loadSession,loadLeagueSnapshots,storeConfigured} from './auth/yahoo/_store.js';
import {dataHealth} from '../decision-core.mjs';
const SECTIONS=['settings','teams','standings','scoreboard','roster'];
export function snapshotHealth(snapshot,{now=Date.now()}={}){
 const sources=SECTIONS.map(name=>({name,observedAt:snapshot?.[name]?.observed_at||null,maxAgeMs:30*60*60*1000}));
 const health=dataHealth(sources,{now});
 return {status:health.healthy?'healthy':'degraded',sections:health.checks.map(x=>({section:x.source,status:x.status,observedAt:snapshot?.[x.source]?.observed_at||null,ageMs:x.ageMs})),missing:health.checks.filter(x=>x.status==='MISSING').map(x=>x.source),stale:health.checks.filter(x=>x.status==='STALE').map(x=>x.source),readOnly:true};
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(!configured()||!storeConfigured())return res.status(503).json({status:'unavailable',error:'Yahoo data connection unavailable'});
 try{
  const sid=cookies(req).yahoo_session;
  if(!sid||!(await loadSession(sid)))return res.status(401).json({status:'not_connected',error:'Yahoo sign-in required'});
  const snapshot=await loadLeagueSnapshots(85892);
  return res.status(200).json({mode:'YAHOO_SYSTEM_HEALTH',leagueId:85892,checkedAt:new Date().toISOString(),...snapshotHealth(snapshot)});
 }catch(e){return res.status(503).json({status:'unavailable',error:'Health check unavailable'});}
}
