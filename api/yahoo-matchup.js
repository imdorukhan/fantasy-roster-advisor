// Current Yahoo public matchup adapter. No fixed week or opponent IDs.
// This endpoint is observational; no fantasy transactions are performed.
import {ingest} from '../matchup-data.mjs';
import {categoryComparison} from '../decision-core.mjs';

export function formatCurrentMatchup(snapshot){
 if(!snapshot||snapshot.status!=='observed'||!snapshot.matchup?.ours||!snapshot.matchup?.opponent)throw Error('Current Yahoo matchup not verified');
 const {ours,opponent}=snapshot.matchup;
 if(Number(ours.id)!==5||Number(opponent.id)===5)throw Error('Matchup identity mismatch');
 const comparison=categoryComparison(ours.stats,opponent.stats);
 if(!comparison.verified)throw Error('Invalid Yahoo categories: '+comparison.reason);
 const source=snapshot.sources?.find(x=>x.source==='Yahoo matchup');
 if(source?.status!=='retrieved')throw Error('Yahoo matchup source unavailable');
 return {
  mode:'CURRENT_YAHOO_PUBLIC_MATCHUP',source:'Yahoo Fantasy Basketball public matchup',sourceUrl:source.url,
  leagueId:85892,week:null,weekVerified:false,ourTeam:{id:Number(ours.id),name:ours.name,stats:ours.stats},
  opponent:{id:Number(opponent.id),name:opponent.name,stats:opponent.stats},
  categories:comparison.rows.map(c=>({category:c.category,ours:c.ours,opponent:c.opponent,leader:c.leader})),
  score:comparison.score,
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
