import {withScopedTransaction} from './sc3-postgres.mjs';
import {yahooWindow} from './sc3-streaming-plan.mjs';
export async function readLeagueRosters(){
 const rows=await withScopedTransaction(async client=>(await client.query(
  "select section,payload,observed_at::text from sc3.yahoo_league_snapshots where league_id=85892 and source='Yahoo Fantasy Sports API' and section in ('all_rosters','settings','roster','scoreboard')"
 )).rows);
 const sections=Object.fromEntries(rows.map(row=>[row.section,row]));
 const row=sections.all_rosters;
 const d=row?.payload;
 const age=Date.now()-Date.parse(row?.observed_at);
 if(!Number.isFinite(age)||age<0||age>30*3600_000||d?.complete!==true||d.leagueId!==85892||
    d.mode!=='YAHOO_ALL_ROSTERS'||d.teamCount!==14||d.teams?.length!==14||
    new Set(d.teams.map(team=>team.key)).size!==14||
    d.teams.some(team=>!/^478\.l\.85892\.t\.(?:[1-9]|1[0-4])$/.test(team.key)||!team.players?.length))throw Error('Invalid roster snapshot');
 const players=d.teams.flatMap(team=>team.players);
 if(players.length!==d.playerCount||new Set(players.map(player=>player.yahooId)).size!==players.length||
    players.some(player=>!/^\d+$/.test(player.yahooId)))throw Error('Invalid roster snapshot');
 let acquisitions=null;
 try{acquisitions=yahooWindow(sections,new Date()).acquisitions;}catch{}
 const team=d.teams.find(team=>team.key==='478.l.85892.t.5');
 const {readPerformance}=await import('./performance-store.mjs');
 let coverage=null,byId=new Map();
 try{
  const perf=await readPerformance({scoped:true,start:process.env.SC3_SEASON_START});
  const {profileCoverage}=await import('./sc3-roster-identity.mjs');
  const byEspn=new Map(perf.report.players.map(p=>[String(p.id),p]));
  const links=[...perf.links].map(([yahoo_id,espn_id])=>({yahoo_id,espn_id,persisted:perf.persistedLinks?.has(yahoo_id)??null}));
  const counts=new Map(perf.report.players.map(p=>[String(p.id),p.season?.games??0]));
  const info=profileCoverage(players,links,counts);
  byId=new Map(info.map(p=>[p.yahooId,{...p,analytics:byEspn.has(p.espnId)?{season:byEspn.get(p.espnId).season,fresh:perf.fresh,historyEnd:perf.historyEnd}:null}]));
  coverage={total:players.length,linked:info.filter(p=>p.espnId).length,withGames:info.filter(p=>p.games>0).length,threeGames:info.filter(p=>p.games>=3).length,persisted:info.filter(p=>p.persisted===true).length,historyThrough:perf.historyEnd,fresh:perf.fresh};
 }catch{}
 const teams=d.teams.map(t=>({...t,players:t.players.map(p=>({...p,profileCoverage:byId.get(p.yahooId)??null}))}));
 return {...d,teams,profileCoverage:coverage,observedAt:row.observed_at,acquisitions,ilCount:team.players.filter(p=>/^(IL|IR)/.test(p.slot)).length};
}
