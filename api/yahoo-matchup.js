// Current Yahoo public matchup adapter. No fixed week or opponent IDs.
// This endpoint is observational; no fantasy transactions are performed.
import {ingest,analyzeMatchup} from '../matchup-data.mjs';

export function formatCurrentMatchup(snapshot){
 if(!snapshot||snapshot.status!=='observed'||!snapshot.matchup?.ours||!snapshot.matchup?.opponent)throw Error('Current Yahoo matchup not verified');
 const {ours,opponent}=snapshot.matchup;
 if(Number(ours.id)!==5||Number(opponent.id)===5)throw Error('Matchup identity mismatch');
 const analysis=snapshot.analysis||analyzeMatchup(snapshot.matchup);
 if(!Array.isArray(analysis.comparison)||analysis.comparison.length!==9)throw Error('Invalid Yahoo categories');
 const source=snapshot.sources?.find(x=>x.source==='Yahoo matchup');
 if(source?.status!=='retrieved')throw Error('Yahoo matchup source unavailable');
 return {
  mode:'CURRENT_YAHOO_PUBLIC_MATCHUP',source:'Yahoo Fantasy Basketball public matchup',sourceUrl:source.url,
  leagueId:85892,week:null,weekVerified:false,ourTeam:{id:Number(ours.id),name:ours.name,stats:ours.stats},
  opponent:{id:Number(opponent.id),name:opponent.name,stats:opponent.stats},
  categories:analysis.comparison.map(c=>({category:c.category,ours:c.ours,opponent:c.theirs,leader:c.status==='leading'?'OURS':c.status==='trailing'?'OPPONENT':'TIE'})),
  score:{ours:analysis.wins,opponent:analysis.losses,ties:analysis.ties},
  observedAt:snapshot.fetchedAt,readOnly:true,executable:false,
  warning:'Observed Yahoo public category totals. Week number and lineup locks need authenticated verification.'
 };
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 try{return res.status(200).json(formatCurrentMatchup(await ingest()));}
 catch(e){return res.status(503).json({error:'Current Yahoo matchup unavailable',reason:e.message,readOnly:true});}
}
