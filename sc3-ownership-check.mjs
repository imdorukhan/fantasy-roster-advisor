import {collect} from './scripts/collect-yahoo-ownership.mjs';
const fingerprint=p=>JSON.stringify([String(p.yahooId),p.name,p.yahooRosterStatus,p.nbaTeam??null,[...(p.eligiblePositions??[])].sort()]);
export function compareOwnership(stored,live){
 const old=new Map(stored.map(p=>[String(p.yahooId),fingerprint(p)])),current=new Map(live.map(p=>[String(p.yahooId),fingerprint(p)]));
 if(old.size!==stored.length||current.size!==live.length)throw Error('Duplicate Yahoo ownership IDs');
 return {added:[...current.keys()].filter(id=>!old.has(id)).length,removed:[...old.keys()].filter(id=>!current.has(id)).length,changed:[...current.keys()].filter(id=>old.has(id)&&old.get(id)!==current.get(id)).length};
}
export async function recheckOwnership(snapshot,{fetcher=fetch,collector=collect,signal=AbortSignal.timeout(60000)}={}){
 const groups=await Promise.all([['FA','freeAgents'],['W','waivers']].map(async([filter,key])=>{
  const players=[];
  const result=await collector(filter,page=>players.push(...page.players),{fetcher,signal});
  if(!result.complete||result.count!==players.length)throw Error('Incomplete Yahoo ownership observation');
  const diff=compareOwnership(snapshot[key].players,players);
  return [key,{count:players.length,pageCount:result.pageCount,observedAt:result.observedAt,snapshotCount:snapshot[key].count,...diff},players];
 }));
 const a=new Set(groups[0][2].map(p=>p.yahooId));
 if(groups[1][2].some(p=>a.has(p.yahooId)))throw Error('Conflicting live Yahoo ownership');
 const summary=Object.fromEntries(groups.map(([key,data])=>[key,data]));
 const status=Object.values(summary).every(p=>p.added+p.removed+p.changed===0)?'MATCH':'CHANGED';
 return {status,...summary,readOnly:true};
}
