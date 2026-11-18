// Conservative provider linking. Names alone never auto-approve.
const norm=s=>String(s??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const team=s=>({GS:'GSW',NY:'NYK',NO:'NOP',SA:'SAS',UTAH:'UTA',WSH:'WAS',PHO:'PHX',BKN:'BKN',BRK:'BKN'}[String(s??'').toUpperCase()]||String(s??'').toUpperCase());
const id=x=>/^\d+$/.test(String(x??''));
export function matchPlayers(yahoo,espn){
 const byName=new Map(),out=[],used=new Map();
 for(const p of espn){if(!id(p.espnId)||!norm(p.name))continue;const k=norm(p.name);if(!byName.has(k))byName.set(k,[]);byName.get(k).push(p)}
 for(const y of yahoo){
  if(!id(y.yahooId)||!norm(y.name))continue;
  const candidates=(byName.get(norm(y.name))||[]).filter(p=>id(p.espnId));
  const same=candidates.filter(p=>team(y.nbaTeam)&&team(y.nbaTeam)===team(p.team));
  const exact=same.filter(p=>y.birthDate&&p.birthDate&&y.birthDate===p.birthDate);
  const selected=exact.length===1&&same.length===1?exact[0]:null;
  const row={yahooId:String(y.yahooId),espnId:selected?String(selected.espnId):null,status:selected?'verified':same.length===1?'candidate':'unresolved',candidateIds:same.map(p=>String(p.espnId)),evidence:selected?'unique normalized name + team + exact birth date':same.length===1?'name + team; independent identity evidence required':'missing or ambiguous team/name match'};
  out.push(row);if(selected){const key=row.espnId;if(!used.has(key))used.set(key,[]);used.get(key).push(row)}
 }
 for(const list of used.values())if(list.length>1)for(const r of list){r.espnId=null;r.status='unresolved';r.evidence='conflicting one-to-one identity'}
 return out;
}
