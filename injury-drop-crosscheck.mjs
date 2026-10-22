import {rankDropRisk} from './drop-risk.mjs';
const norm=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const validDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'));
const diff=(a,b)=>(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
const statuses=new Set(['out','inj','questionable','doubtful','probable','gtd','minutes restriction','returning','rehab','limited practice']);
const sourceTypes=new Set(['official_nba','team_statement','espn','rotowire','cbs','reporter','other']);
/**
 * Links documented injuries to a slump window. This is temporal association only,
 * never proof of injury causation. Never upgrades any player into DROP_REVIEW.
 */
export function assessSlumpsWithInjuries({roster,reports,today,weights={}}){
 if(!Array.isArray(roster)||!Array.isArray(reports)||!validDate(today))throw Error('Invalid inputs');
 const base=rankDropRisk({roster,weights});
 const byName=new Map(roster.map(p=>[norm(p.name),p]));
 return base.map(record=>{
  const p=byName.get(norm(record.player));
  const played=(p.lastGames||[]).filter(g=>g.played===true&&validDate(g.date)).sort((a,b)=>a.date.localeCompare(b.date)).slice(-3);
  const start=played[0]?.date, end=played.at(-1)?.date;
  const matched=reports.filter(r=>norm(r.player)===norm(record.player)&&validDate(r.publishedAt)&&sourceTypes.has(r.source)&&typeof r.url==='string'&&r.url.startsWith('https://')&&r.publishedAt<=today&&diff(today,r.publishedAt)<=14&&statuses.has(String(r.status||'').toLowerCase())&&((start&&end&&r.injuryStart&&validDate(r.injuryStart)&&r.injuryStart<=end&&(!r.injuryEnd||r.injuryEnd>=start))||(start&&end&&diff(r.publishedAt,start)>=-3&&diff(r.publishedAt,end)<=3)));
  const sources=[...new Set(matched.map(r=>r.source))];
  const official=matched.some(r=>['official_nba','team_statement'].includes(r.source));
  const corroborated=official||sources.length>=2;
  const association=matched.length&&!start?'INJURY_REPORTED_NO_DATED_GAMES':matched.length&&corroborated?'POSSIBLE_INJURY_CONNECTION':matched.length?'UNCONFIRMED_INJURY_CONNECTION':'NO_RECENT_MATCHING_REPORT';
  const preventDrop=association!=='NO_RECENT_MATCHING_REPORT';
  const explanation=association==='POSSIBLE_INJURY_CONNECTION'?'Recent documented injury overlaps slump window; may explain decline but causation is unproven. Do not drop without recovery review.':association==='UNCONFIRMED_INJURY_CONNECTION'?'Single nonofficial injury report near slump window; verify before any drop.':association==='INJURY_REPORTED_NO_DATED_GAMES'?'Injury report exists but dated game evidence is missing; avoid causal claims.':'No sufficiently documented recent injury report matched; absence of evidence is not proof of fitness.';
  return {...record,status:preventDrop&&record.status==='DROP_REVIEW'?'INJURY_REVIEW':record.status,dropCandidate:preventDrop?false:record.dropCandidate,injuryCaution:record.injuryCaution||preventDrop,injuryAssociation:association,injuryExplanation:explanation,injurySources:matched.map(r=>({source:r.source,url:r.url,publishedAt:r.publishedAt,injuryStart:r.injuryStart||null,status:r.status})),injuryConfirmedCausal:false,requiresApproval:true,executable:false};
 });
}
