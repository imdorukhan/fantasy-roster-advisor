// Share the same complete, fail-closed Yahoo availability observation as Streaming.
import {streamingAvailability} from './sc3-streaming.mjs';
import {stableLiveOwnership} from './sc3-ownership-check.mjs';

export function resolveProfileOwnership(rows,id,observation,now=new Date()){
 if(!['MATCH','LIVE_VERIFIED'].includes(observation?.status)||!observation.live)throw Error('Live Yahoo ownership unavailable');
 const live=observation.live;
 const available=[];
 for(const [group,ownership] of [[live.freeAgents,'FREE_AGENT'],[live.waivers,'WAIVERS']]){
  for(const player of group.players)if(player.yahooId===id)available.push({player,ownership,observedAt:group.observedAt,ownershipSource:'Yahoo live league player list',ownershipCheck:observation.status});
 }
 if(available.length>1)throw Error('Conflicting Yahoo player ownership');
 if(available.length===1)return available[0];
 const row=rows.all_rosters,d=row?.payload,age=+now-Date.parse(row?.observed_at);
 if(!Number.isFinite(age)||age<0||age>30*3600_000||d?.leagueId!==85892||d.mode!=='YAHOO_ALL_ROSTERS'||d.complete!==true||d.teamCount!==14||d.teams?.length!==14||
    new Set(d.teams.map(t=>t.key)).size!==14||d.teams.some(t=>!/^478\.l\.85892\.t\.(?:[1-9]|1[0-4])$/.test(t.key)||!Array.isArray(t.players)||!t.players.length))return null;
 const players=d.teams.flatMap(t=>t.players);
 if(players.length!==d.playerCount||new Set(players.map(p=>p.yahooId)).size!==players.length)return null;
 const found=d.teams.flatMap(t=>t.players.filter(p=>p.yahooId===id).map(player=>({player,teamKey:t.key,fantasyTeam:t.name,ownership:'ROSTERED',observedAt:row.observed_at,ownershipSource:'Yahoo roster snapshot; absent from current FA and waiver lists',ownershipCheck:observation.status})));
 return found.length===1?found[0]:null;
}

export async function observeProfileOwnership(rows,{now=new Date(),fetcher=fetch,observer=stableLiveOwnership}={}){
 const stored=streamingAvailability(Object.values(rows),+now);
 const observed=await observer(stored,{fetcher});
 if(!['MATCH','LIVE_VERIFIED'].includes(observed?.status)||!observed.live)throw Error('Live Yahoo ownership unavailable');
 return observed;
}

export function excludeAvailableFromRoster(roster,observation){
 const ids=new Set([...observation.live.freeAgents.players,...observation.live.waivers.players].map(p=>p.yahooId));
 return roster.filter(p=>!ids.has(p.yahooId));
}
