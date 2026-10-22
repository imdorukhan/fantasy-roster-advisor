import {findSnapshotOwner} from './ownership.mjs';
const MS_DAY=86400000;
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const dateOnly=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'));
const dayDiff=(a,b)=>Math.round((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/MS_DAY);
const priority={official_nba:4,team_statement:4,espn:3,rotowire:3,cbs:2,other:1};
export function evaluateInjuryRadar({players,reports,today,daysAhead=14,minFantasyValue=60}){
 if(!dateOnly(today))throw Error('today must be YYYY-MM-DD');
 if(!Array.isArray(players)||!Array.isArray(reports))throw Error('players/reports arrays required');
 const grouped=new Map();
 for(const r of reports){
  if(!r?.player||!r?.source||!r?.url||!r?.observedAt||!dateOnly(r.observedAt))continue;
  const k=normalize(r.player);
  if(!grouped.has(k))grouped.set(k,[]);
  grouped.get(k).push({...r,sourceWeight:priority[r.source]||1});
 }
 const alerts=[];
 for(const player of players){
  const ownership=player.availability;
  if(ownership==='OWNED'||findSnapshotOwner(player.name))continue;
  const recent=(grouped.get(normalize(player.name))||[]).filter(r=>dayDiff(today,r.observedAt)>=0&&dayDiff(today,r.observedAt)<=3).sort((a,b)=>b.sourceWeight-a.sourceWeight||b.observedAt.localeCompare(a.observedAt));
  if(!recent.length)continue;
  const dates=recent.filter(r=>dateOnly(r.estimatedReturnDate)&&!r.seasonEnding);
  const top=dates.find(r=>dayDiff(r.estimatedReturnDate,today)>=-1&&dayDiff(r.estimatedReturnDate,today)<=daysAhead)||dates[0]||recent[0];
  const days=top.estimatedReturnDate?dayDiff(top.estimatedReturnDate,today):null;
  const upcoming=days!==null&&days>=-1&&days<=daysAhead;
  const signals=recent.some(r=>r.practiceStatus==='full'||r.practiceStatus==='returned'||r.status==='probable'||r.status==='available');
  if(!upcoming&&!signals)continue;
  const conflicting=dates.length>1&&dates.some(r=>Math.abs(dayDiff(r.estimatedReturnDate,top.estimatedReturnDate))>3);
  const confirmedFA=ownership==='FA'&&player.liveYahooVerified===true;
  const value=Number(player.fantasyValue);
  const valueVerified=Number.isFinite(value)&&player.valueMethodVerified===true;
  const strongValue=valueVerified&&value>=minFantasyValue;
  const sourceGood=recent.some(r=>r.source==='official_nba'||r.source==='team_statement')||new Set(recent.map(r=>r.source)).size>=2;
  const recommendation=confirmedFA&&strongValue&&sourceGood&&!conflicting?'PICKUP_REVIEW':'WATCH_ONLY';
  alerts.push({player:player.name,recommendation,returnDate:top.estimatedReturnDate||null,returnDateKind:top.dateType||'estimate',daysUntilEstimate:days,injuryStatus:top.status||'unknown',fantasyValue:valueVerified?value:null,availability:ownership,liveYahooVerified:player.liveYahooVerified===true,conflictingSources:conflicting,sourceCount:new Set(recent.map(r=>r.source)).size,sources:recent.map(r=>({source:r.source,url:r.url,observedAt:r.observedAt,estimate:r.estimatedReturnDate||null})),reason:recommendation==='PICKUP_REVIEW'?'Verified FA, sufficient value and independent injury support; requires manual approval':'Verify live Yahoo availability, player value, return uncertainty and source consensus',requiresApproval:true,executable:false});
 }
 return alerts.sort((a,b)=>(a.recommendation==='PICKUP_REVIEW'?-1:1)-(b.recommendation==='PICKUP_REVIEW'?-1:1)||(a.daysUntilEstimate??999)-(b.daysUntilEstimate??999));
}
