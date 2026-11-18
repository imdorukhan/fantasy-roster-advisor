import {parsePage} from './scripts/collect-yahoo-ownership.mjs';

const alias={GS:'GSW',NO:'NOP',NY:'NYK',SA:'SAS',WSH:'WAS',BRK:'BKN',UTAH:'UTA',PHO:'PHX'};
const club=value=>alias[value]??value;
const hybrid={G:['PG','SG'],F:['SF','PF'],FC:['SF','PF','C'],Util:['PG','SG','SF','PF','C']};
function fits(player,slot){
 return player.eligiblePositions.includes(slot)||(hybrid[slot]??[]).some(pos=>player.eligiblePositions.includes(pos));
}
export function maxStarts(players,slots){
 const assigned=Array(slots.length).fill(null);
 function place(player,seen){
  for(let i=0;i<slots.length;i++){
   if(seen.has(i)||!fits(player,slots[i]))continue;
   seen.add(i);
   if(!assigned[i]||place(assigned[i],seen)){assigned[i]=player;return true;}
  }
  return false;
 }
 return players.reduce((count,player)=>count+Number(place(player,new Set())),0);
}
const dateLabel=date=>new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric'}).format(new Date(date+'T12:00:00Z'));

export function rankWaiverOpportunities(candidates,days,starters){
 const slots=starters.flatMap(slot=>Array(slot.count).fill(slot.position));
 const windows=days.map(({date,schedule,lineup})=>{
  if(!schedule||!lineup)return {date,verified:false,active:[]};
  const eligible=lineup.filter(p=>p.occupied&&!/^(IL|IR)/.test(p.slot));
  const verified=eligible.every(p=>p.nbaTeam&&p.eligiblePositions?.length);
  const active=eligible.filter(p=>schedule.teams.has(club(p.nbaTeam)));
  return {date,verified,teams:schedule.teams,active,baseline:verified?maxStarts(active,slots):null};
 });
 return candidates.map(candidate=>{
  const clears=days.find(day=>'W ('+dateLabel(day.date)+')'===candidate.yahooRosterStatus)?.date??null;
  const dates=clears?windows.filter(day=>day.date>clears&&day.verified&&day.teams.has(club(candidate.nbaTeam))&&
   maxStarts([...day.active,candidate],slots)>day.baseline).map(day=>day.date):[];
  return {yahooId:candidate.yahooId,name:candidate.name,nbaTeam:candidate.nbaTeam,waiverStatus:candidate.yahooRosterStatus,clears,dates,
    extraStarts:clears&&windows.filter(day=>day.date>clears).every(day=>day.verified)?dates.length:null};
 }).sort((a,b)=>(b.extraStarts??-1)-(a.extraStarts??-1)||a.name.localeCompare(b.name));
}

export async function readWaiverOpportunities(waivers,days,starters,budget,fetcher=fetch,{rankAll=false}={}){
 let verified=waivers.players.filter(p=>p.nbaTeam&&p.eligiblePositions?.length);
 let source='Yahoo SC3 waiver snapshot';
 if(verified.length<waivers.count){
  const url='https://basketball.fantasysports.yahoo.com/nba/85892/players?status=W';
  const response=await fetcher(url,{signal:AbortSignal.timeout(7500),redirect:'error'});
  if(!response.ok)throw Error('Current Yahoo waiver candidates unavailable');
  const {players}=parsePage(await response.text(),'W');
  const saved=new Map(waivers.players.map(p=>[p.yahooId,p]));
  const merged=new Map(verified.map(player=>[player.yahooId,player]));
  for(const player of players)if(saved.get(player.yahooId)?.yahooRosterStatus===player.yahooRosterStatus&&player.nbaTeam&&player.eligiblePositions?.length){
   merged.set(player.yahooId,player);
  }
  verified=[...merged.values()];
  source='Yahoo SC3 snapshot and first live Yahoo page';
 }
 const ranked=rankWaiverOpportunities(verified,days,starters);
 return {evaluated:verified.length,rankable:ranked.filter(player=>player.extraStarts!==null).length,
  source,totalWaivers:waivers.count,remainingAdds:budget.remaining,rows:rankAll?ranked:ranked.slice(0,25),readOnly:true};
}
