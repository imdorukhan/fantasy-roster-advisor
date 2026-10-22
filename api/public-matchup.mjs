import {ingest} from '../matchup-data.mjs';
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Read-only endpoint'});
 try{res.status(200).json(await ingest());}catch{res.status(503).json({status:'unavailable',error:'Source retrieval failed',executable:false});}
}
