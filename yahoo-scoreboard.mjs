// Authenticated Yahoo Fantasy Sports API 9-CAT scoreboard normalization.
// Exactly league 85892 / team 5. No public-page guesses or historical fallback.
import {categoryComparison} from './decision-core.mjs';
export const YAHOO_STAT_IDS=Object.freeze({'FG%':'5','FT%':'8','3PM':'10',PTS:'12',REB:'15',AST:'16',STL:'17',BLK:'18',TO:'19'});
const MY_KEY='478.l.85892.t.5';
const validDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s);
export const leagueToday=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
function teamsFor(matchup){
 const list=matchup?.['0']?.teams;
 if(!list||typeof list!=='object')throw Error('Yahoo matchup teams unavailable');
 return Object.entries(list).filter(([key])=>/^\d+$/.test(key)).map(([,v])=>{
  const array=v?.team;
  if(!Array.isArray(array)||!Array.isArray(array[0]))throw Error('Yahoo team metadata unavailable');
  const meta=array[0].filter(x=>x&&typeof x==='object'&&!Array.isArray(x));
  const key=meta.find(x=>typeof x.team_key==='string')?.team_key;
  const name=meta.find(x=>typeof x.name==='string')?.name;
  const value=array[1]||{};
  const stats=value.team_stats?.stats;
  if(!key||!Array.isArray(stats))throw Error('Yahoo team stats unavailable');
  const statMap=new Map(stats.map(x=>x?.stat).filter(x=>x?.stat_id!==undefined).map(x=>[String(x.stat_id),x.value]));
  const normalized={};
  for(const [cat,id] of Object.entries(YAHOO_STAT_IDS)){
   const raw=statMap.get(id);
   if(raw===null||raw===undefined||raw==='')throw Error('Missing official '+cat);
   const n=Number(raw);
   if(!Number.isFinite(n)||n<0||((cat==='FG%'||cat==='FT%')&&n>1))throw Error('Invalid official '+cat);
   normalized[cat]=n;
  }
  return {key,id:Number(key.split('.t.').at(-1)),name:name||key,stats:normalized,remainingGames:value.team_remaining_games?.total?.remaining_games??null,completedGames:value.team_remaining_games?.total?.completed_games??null,scoredPoints:Number(value.team_points?.total)};
 });
}
export function officialMatchupFromScoreboard(raw,{observedAt,now=new Date(),teamKey=MY_KEY,maxAgeMs=30*60*60*1000}={}){
 if(teamKey!==MY_KEY)throw Error('Unexpected team key');
 const date=leagueToday(now);
 if(!validDay(date))throw Error('Yahoo league date unavailable');
 const age=Date.parse(observedAt);
 if(!Number.isFinite(age)||Math.abs(now.getTime()-age)>maxAgeMs||age>now.getTime()+60000)throw Error('Yahoo scoreboard snapshot stale or undated');
 const matchups=raw?.league?.[1]?.scoreboard?.[0]?.matchups;
 if(!matchups||typeof matchups!=='object')throw Error('Yahoo scoreboard format unavailable');
 const candidates=Object.entries(matchups).filter(([k])=>/^\d+$/.test(k)).map(([,entry])=>entry?.matchup).filter(Boolean);
 const current=candidates.filter(m=>validDay(m.week_start)&&validDay(m.week_end)&&m.week_start<=date&&date<=m.week_end);
 const matching=current.map(m=>{try{const t=teamsFor(m);return {matchup:m,teams:t}}catch{return null}}).filter(x=>x&&x.teams.some(t=>t.key===teamKey));
 if(matching.length!==1)throw Error('Exactly one official current Yahoo matchup required');
 const {matchup,teams}=matching[0],ours=teams.find(t=>t.key===teamKey),opponent=teams.find(t=>t.key!==teamKey);
 if(teams.length!==2||!ours||!opponent||!Number.isInteger(Number(matchup.week))||Number(matchup.week)<1)throw Error('Opponent or week not verified');
 const comparison=categoryComparison(ours.stats,opponent.stats);
 if(!comparison.verified)throw Error('Invalid official categories: '+comparison.reason);
 // Yahoo gives each category winner independently. Require full agreement.
 const winners=matchup.stat_winners||[];
 if(!Array.isArray(winners)||winners.length!==9)throw Error('Yahoo stat winners unavailable');
 for(const row of comparison.rows){
  const id=YAHOO_STAT_IDS[row.category];
  const item=winners.find(x=>String(x?.stat_winner?.stat_id)===id)?.stat_winner;
  if(!item)throw Error('Missing Yahoo official winner '+row.category);
  const expected=row.leader==='OURS'?ours.key:row.leader==='OPPONENT'?opponent.key:null;
  if((item.winner_team_key||null)!==expected)throw Error('Yahoo category winner mismatch: '+row.category);
 }
 if(Number.isFinite(ours.scoredPoints)&&ours.scoredPoints!==comparison.score.ours)throw Error('Yahoo team points mismatch');
 if(Number.isFinite(opponent.scoredPoints)&&opponent.scoredPoints!==comparison.score.opponent)throw Error('Yahoo opponent points mismatch');
 return {
  mode:'YAHOO_OFFICIAL_MATCHUP',source:'Yahoo Fantasy Sports API',leagueId:85892,teamId:5,week:Number(matchup.week),
  weekStart:matchup.week_start,weekEnd:matchup.week_end,weekVerified:true,observedAt,
  ourTeam:ours,opponent,categories:comparison.rows,score:comparison.score,readOnly:true,
  executable:false,warning:'Official weekly totals, but remaining lineup appearances and projected future category wins are not validated.'
 };
}
