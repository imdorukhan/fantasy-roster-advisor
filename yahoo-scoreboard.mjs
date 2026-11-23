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
  // At the start of a new Yahoo week, the matchup and opponent are already
  // published but category values are empty until Yahoo has scoring data.
  if(Object.values(YAHOO_STAT_IDS).every(id=>statMap.get(id)==null||statMap.get(id)===''))
   throw Error('Yahoo current-week category totals not published');
  for(const [cat,id] of Object.entries(YAHOO_STAT_IDS)){
   const raw=statMap.get(id);
   if(raw===null||raw===undefined||raw==='')throw Error('Missing official '+cat);
   const n=Number(raw);
   if(!Number.isFinite(n)||n<0||((cat==='FG%'||cat==='FT%')&&n>1))throw Error('Invalid official '+cat);
   normalized[cat]=n;
  }
  function shotPair(id){
   const match=String(statMap.get(id)??'').match(/^(\d+)\/(\d+)$/);
   if(!match)return null;
   const [,made,attempted]=match.map(Number);
   return Number.isSafeInteger(made)&&Number.isSafeInteger(attempted)&&made<=attempted?[made,attempted]:null;
  }
  const fg=shotPair('9004003'),ft=shotPair('9007006');
  const haveFg=statMap.has('9004003'),haveFt=statMap.has('9007006');
  if(haveFg!==haveFt||(haveFg&&(!fg||!ft)))throw Error('Incomplete official Yahoo shooting attempts');
  // Yahoo score percentages and optional made/attempts must describe the same
  // shots. Otherwise a source mix-up can fabricate category-impact math.
  if(fg&&ft){
   const rates=[['FG%',fg],['FT%',ft]];
   for(const [cat,[made,attempted]] of rates){
    const rate=attempted?made/attempted:0;
    if(Math.abs(rate-normalized[cat])>0.00051)throw Error('Yahoo shooting percentage mismatch: '+cat);
   }
  }
  const shooting=fg&&ft?{FGM:fg[0],FGA:fg[1],FTM:ft[0],FTA:ft[1]}:null;
  return {key,id:Number(key.split('.t.').at(-1)),name:name||key,stats:normalized,shooting,remainingGames:value.team_remaining_games?.total?.remaining_games??null,completedGames:value.team_remaining_games?.total?.completed_games??null,scoredPoints:Number(value.team_points?.total)};
 });
}
function selectCurrentMatchup(raw,{observedAt,now=new Date(),teamKey=MY_KEY,maxAgeMs=30*60*60*1000}={}){
 if(teamKey!==MY_KEY)throw Error('Unexpected team key');
 const date=leagueToday(now);
 if(!validDay(date))throw Error('Yahoo league date unavailable');
 const age=Date.parse(observedAt);
 if(!Number.isFinite(age)||Math.abs(now.getTime()-age)>maxAgeMs||age>now.getTime()+60000)throw Error('Yahoo scoreboard snapshot stale or undated');
 const matchups=raw?.league?.[1]?.scoreboard?.[0]?.matchups;
 if(!matchups||typeof matchups!=='object')throw Error('Yahoo scoreboard format unavailable');
 // Identify the current fixture from team metadata, not category totals.
 // A week can be valid while all nine Yahoo stat values are still blank.
 const matching=Object.entries(matchups).filter(([key])=>/^\d+$/.test(key)).map(([,entry])=>{
  const m=entry?.matchup;
  if(!m||!validDay(m.week_start)||!validDay(m.week_end)||m.week_start>date||m.week_end<date)return null;
  const list=m?.['0']?.teams;
  if(!list||typeof list!=='object')return null;
  const entries=Object.entries(list).filter(([key])=>/^\d+$/.test(key));
  if(entries.length!==2)return null;
  const teams=entries.map(([,entry])=>{
   const meta=entry?.team?.[0];
   if(!Array.isArray(meta))return null;
   const key=meta.find(x=>typeof x?.team_key==='string')?.team_key;
   if(!/^478\.l\.85892\.t\.\d+$/.test(key||''))return null;
   const id=Number(key.split('.t.').at(-1));
   if(!Number.isInteger(id)||id<1||id>100)return null;
   const name=meta.find(x=>typeof x?.name==='string')?.name||key;
   return {id,key,name};
  });
  if(teams.some(t=>!t)||new Set(teams.map(t=>t.key)).size!==2||!teams.some(t=>t.key===teamKey))return null;
  return {matchup:m,teams};
 }).filter(Boolean);
 if(matching.length!==1)throw Error('Exactly one official current Yahoo matchup required');
 const {matchup,teams}=matching[0];
 if(!Number.isInteger(Number(matchup.week))||Number(matchup.week)<1)throw Error('Opponent or week not verified');
 return {matchup,teams,observedAt};
}
export function currentMatchupIdentityFromScoreboard(raw,opts={}){
 const {matchup,teams,observedAt}=selectCurrentMatchup(raw,opts);
 return {leagueId:85892,teamId:5,week:Number(matchup.week),
  weekStart:matchup.week_start,weekEnd:matchup.week_end,weekVerified:true,
  ourTeam:teams.find(t=>t.key===MY_KEY),opponent:teams.find(t=>t.key!==MY_KEY),
  observedAt,scoreVerified:false,readOnly:true};
}
export function officialMatchupFromScoreboard(raw,{observedAt,now=new Date(),teamKey=MY_KEY,maxAgeMs=30*60*60*1000}={}){
 const {matchup}=selectCurrentMatchup(raw,{observedAt,now,teamKey,maxAgeMs});
 const teams=teamsFor(matchup);
 const ours=teams.find(t=>t.key===teamKey),opponent=teams.find(t=>t.key!==teamKey);
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
