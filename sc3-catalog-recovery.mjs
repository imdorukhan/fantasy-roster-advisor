import {teamCode} from './sc3-depth-store.mjs';
const normalize=s=>String(s??'').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const key=(name,team)=>normalize(name)+'|'+teamCode(team??'');
export async function missingHistoryCatalog(c,through){
 if(!through)return [];
 return (await c.query(
  "select distinct on (g.espn_id) g.espn_id as \"espnId\",g.player_name as name,g.nba_team as team,count(*) over (partition by g.espn_id)::int as games from sc3.sc3_nba_game_logs g join sc3.sc3_nba_sync_days d using(game_day) where d.status='complete' and g.game_day<=$1::date and not exists(select 1 from sc3.espn_player_identity e where e.espn_id=g.espn_id) order by g.espn_id,g.game_day desc,g.tipoff desc",[through])).rows;
}
export function parseEspnCatalogProfile(json,seed){
 const a=json?.athlete;
 if(!a||String(a.id)!==String(seed.espnId)||key(a.displayName,a.team?.abbreviation)!==key(seed.name,seed.team))return null;
 const m=String(a.displayDOB??'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
 if(!m)return null;
 const birthDate=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');
 const stamp=Date.parse(birthDate+'T12:00:00Z');
 if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==birthDate)return null;
 if(typeof a.active!=='boolean')return null;
 return {...seed,birthDate,jersey:a.jersey??null,active:a.active,source:'ESPN live athlete profile + completed game logs'};
}
export async function recoverHistoryCatalog(players,seeds,fetcher=fetch,{limit=12}={}){
 const candidates=new Set(players.map(p=>key(p.name,p.nbaTeam)));
 const pending=seeds.filter(s=>/^\d{1,12}$/.test(String(s.espnId))&&candidates.has(key(s.name,s.team))).sort((a,b)=>b.games-a.games).slice(0,limit);
 const recovered=[];
 for(let i=0;i<pending.length;i+=4){
  const batch=await Promise.allSettled(pending.slice(i,i+4).map(async seed=>{
   const url='https://site.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/'+seed.espnId+'?lang=en&region=us';
   const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(5000),cache:'no-store'});
   return r.ok&&!r.redirected?parseEspnCatalogProfile(await r.json(),seed):null;
  }));
  recovered.push(...batch.filter(r=>r.status==='fulfilled'&&r.value).map(r=>r.value));
 }
 return {attempted:pending.length,profiles:recovered};
}
