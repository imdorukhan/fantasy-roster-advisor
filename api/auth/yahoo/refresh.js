import {cookies,configured,authConfig} from './_lib.js';
import {loadSessionRecord,storeConfigured} from './_store.js';
import {yahooSessionClient} from './_refresh.js';
import {YahooSessionError} from '../../../yahoo-session-client.mjs';

export default async function handler(req,res) {
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).end()}
 let origin;
 try{origin=authConfig().origin}catch{return res.status(503).json({error:'OAuth not configured'})}
 if(req.headers.origin!==origin)return res.status(403).json({error:'Invalid origin'});
 if(!configured()||!storeConfigured())return res.status(503).json({error:'OAuth not configured'});
 try {
  const owner=await loadSessionRecord(cookies(req).yahoo_session);
  if(!owner?.tokens?.refresh_token)return res.status(401).json({error:'Not connected'});
  const client=yahooSessionClient(owner);
  await client.ready({force:true});
  return res.status(200).json({connected:true,refreshed:true});
 }catch(error){
  const category=error instanceof YahooSessionError?error.code:'refresh_unavailable';
  return res.status(503).json({error:'Refresh unavailable',category});
 }
}
