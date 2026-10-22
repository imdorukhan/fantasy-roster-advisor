import {getUserSnapshot} from './ownership.mjs';
import {sourceReliability} from './source-reliability.mjs';
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const day=n=>typeof n==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(n)&&!Number.isNaN(Date.parse(n+'T00:00:00Z'));
const delta=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
export function evaluateInjuryRadar({players,reports,today,daysAhead=14,minFantasyValue=60,history=[]}){
 if(!day(today)||!Array.isArray(players)||!Array.isArray(reports))throw Error('Invalid inputs');
 const ownSnapshot=new Set(getUserSnapshot().players.map(p=>norm(p.name)));
 const grouped=new Map();
 for(const r of reports){
  if(!r?.player||!r.source||!r.url||!day(r.observedAt))continue;
  const name=norm(r.player);
  if(!grouped.has(name))grouped.set(name,[]);
  grouped.get(name).push(r);
 }
 const trust=sourceReliability(history);
 const output=[];
 for(const p of players){
  const own=p.ownership==='MY_TEAM'||p.availability==='MY_TEAM'||(ownSnapshot.has(norm(p.name))&&p.ownership!=='OTHER_TEAM'&&p.availability!=='OWNED_OTHER');
  const free=p.availability==='FA'&&p.liveYahooVerified===true&&!own;
  // Unknown, waiver-only, and everyone else's roster are outside the alert scope.
  if(!own&&!free)continue;
  const reportsFor=(grouped.get(norm(p.name))||[]).filter(r=>delta(today,r.observedAt)>=0&&delta(today,r.observedAt)<=3);
  if(!reportsFor.length)continue;
  const dated=reportsFor.filter(r=>day(r.estimatedReturnDate)&&!r.seasonEnding);
  const coming=dated.filter(r=>delta(r.estimatedReturnDate,today)>=-1&&delta(r.estimatedReturnDate,today)<=daysAhead);
  const improvements=reportsFor.some(r=>['full','returned','limited'].includes(r.practiceStatus)||['probable','available'].includes(r.status));
  if(!coming.length&&!improvements)continue;
  const ranked=[...coming,...dated.filter(r=>!coming.includes(r))].sort((a,b)=>(trust[b.source]?.confidence??.5)-(trust[a.source]?.confidence??.5)||b.observedAt.localeCompare(a.observedAt));
  const top=ranked[0]||reportsFor[0];
  const conflict=dated.length>1&&dated.some(r=>Math.abs(delta(r.estimatedReturnDate,top.estimatedReturnDate))>3);
  const sources=[...new Set(reportsFor.map(r=>r.source))];
  const value=Number(p.fantasyValue);
  const valueOK=p.valueMethodVerified===true&&Number.isFinite(value)&&value>=minFantasyValue;
  const corroborated=sources.length>=2||reportsFor.some(r=>['official_nba','team_statement'].includes(r.source));
  const recommendation=own?'MY_TEAM_RETURN_WATCH':valueOK&&corroborated&&!conflict?'PICKUP_REVIEW':'FA_WATCH';
  output.push({player:p.name,scope:own?'MY_TEAM':'VERIFIED_FREE_AGENT',recommendation,estimatedReturnDate:day(top.estimatedReturnDate)?top.estimatedReturnDate:null,daysToEstimate:day(top.estimatedReturnDate)?delta(top.estimatedReturnDate,today):null,conflictingReports:conflict,sources:reportsFor.map(r=>({source:r.source,url:r.url,observedAt:r.observedAt,estimatedReturnDate:r.estimatedReturnDate||null,sourceConfidence:trust[r.source]?.confidence??null,sourceSamples:trust[r.source]?.sampleSize??0})),requiresApproval:true,executable:false});
 }
 return output.sort((a,b)=>Number(a.daysToEstimate??999)-Number(b.daysToEstimate??999));
}
