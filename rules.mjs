import {rankMoves} from './engine.mjs';
import config from './league.config.json' with {type:'json'};
export const LEAGUE=config;
const toCount=x=>Number.isInteger(x)&&x>=0?x:null;
export function evaluateLeagueMoves({roster,availablePlayers,weeklyAcquisitionsUsed,weeklyAcquisitionsPending=0,remainingFab=null,weights={},targets=config.scoringTargets}){
 const used=toCount(weeklyAcquisitionsUsed),pending=toCount(weeklyAcquisitionsPending);
 if(used===null||pending===null)return {status:'NEEDS_VERIFICATION',reason:'Weekly acquisitions and pending claims must be verified before generating actionable recommendations.',moves:[]};
 const left=config.limits.weeklyAdds-used-pending;
 if(left<=0)return {status:'LIMIT_REACHED',remainingAcquisitions:0,moves:[]};
 if(!Array.isArray(roster)||!Array.isArray(availablePlayers))throw Error('Roster and availablePlayers arrays required');
 // Do not use guessed roster eligibility, lineup starts or unknown can-cut status for an executable recommendation.
 const pool=availablePlayers.filter(p=>p.availability==='FA' && p.available===true).map(p=>({...p,waiver:false}));
 const safeRoster=roster.map(p=>({...p,undroppable:p.undroppable!==false||p.keeperProtected===true}));
 const moves=rankMoves({roster:safeRoster,agents:pool,config:{scoring:config.league.scoring,categories:config.categories,targets,weights,topN:20}}).map(x=>({...x,transactionType:'FREE_AGENT',remainingAcquisitions:left,requiresApproval:true,executable:false,checksRequired:['Yahoo current status and can-cut validation','Lineup and roster slot eligibility','Weekly add count at approval time','Acquisition processing time','User approval']}));
 const fabPlayers=availablePlayers.filter(p=>p.availability==='W' || p.waiver===true).map(p=>({id:p.id,name:p.name,transactionType:'FAB_WAIVER_CLAIM',suggestedBid:null,requiresApproval:true,executable:false,reason:'Bid, clearing time and waiver eligibility require verification'}));
 return {status:config.targetsAreEstimates?'SIMULATION_TARGETS':'READY_FOR_REVIEW',remainingAcquisitions:left,moves,waiverWatchlist:fabPlayers,fabRemaining:remainingFab,notes:['No changes to Yahoo roster are submitted','FAB balances and processing require live Yahoo verification']};
}
