// Public ESPN box-score fallback. Read-only, unofficial fantasy comparison.
// Yahoo's started/bench/IL decisions and Yahoo-specific stat corrections are NOT represented.
import rosterSnapshot from '../data/rosters-2026-10-22.json' with {type:'json'};
const BASE='https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const KEY=['FGM','FGA','FTM','FTA','3PM','PTS','REB','AST','STL','BLK','TO'];
const normalize=x=>String(x||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const firstDay='2026-10-20',lastDay='2026-10-26';
const days=(a,b)=>{const result=[];let d=new Date(a+'T12:00:00Z');const end=new Date(b+'T12:00:00Z');for(;d<=end;d.setUTCDate(d.getUTCDate()+1))result.push(d.toISOString().slice(0,10));return result};
const zero=()=>Object.fromEntries(KEY.map(x=>[x,0]));
const ratio=(s,a,b)=>s[b]?Math.round(10000*s[a]/s[b])/100:null;
const ints=s=>{const m=String(s||'').match(/^(\d+)-(\d+)$/);return m?[Number(m[1]),Number(m[2])]:[0,0]};
function safeNum(x){const n=Number(x);return Number.isFinite(n)&&n>=0?n:0}
const stats=(a,labels)=>{const v=Object.fromEntries(labels.map((x,i)=>[x,a.stats?.[i]]));const fg=ints(v.FG),ft=ints(v.FT),three=ints(v['3PT']);return {FGM:fg[0],FGA:fg[1],FTM:ft[0],FTA:ft[1],'3PM':three[0],PTS:safeNum(v.PTS),REB:safeNum(v.REB),AST:safeNum(v.AST),STL:safeNum(v.STL),BLK:safeNum(v.BLK),TO:safeNum(v.TO)}};
async function load(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),7500);try{const r=await fetch(url,{signal:c.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error('ESPN HTTP '+r.status);return await r.json()}finally{clearTimeout(t)}}
const team=(name)=>{const x=rosterSnapshot.teams.find(t=>t.team_name===name);if(!x)throw Error('Roster snapshot team not found '+name);return {name,players:x.players.map(p=>({name:p.name,slot:p.slot,boxScore:zero(),games:0}))}};
function tally(p,entry){for(const k of KEY)p.boxScore[k]+=entry[k];p.games++}
export async function buildMatchup({start=firstDay,end=lastDay}={}){
 const our=team('Salary CAPtain'),opp=team('Şabanoğlu Şaban');
 const lookup=new Map();for(const [side,t] of [['ours',our],['opponent',opp]])for(const p of t.players)lookup.set(normalize(p.name),{side,player:p});
 const today=new Date().toISOString().slice(0,10);const dates=days(start,end).filter(d=>d<=today);
 let events=[],fetchErrors=[],gamesAnalyzed=0;
 for(const d of dates){try{const data=await load(BASE+'/scoreboard?dates='+d.replaceAll('-',''));events.push(...(data.events||[]).filter(e=>e.status?.type?.completed===true))}catch(e){fetchErrors.push({date:d,error:'scoreboard unavailable'})}}
 const unique=[...new Map(events.map(e=>[e.id,e])).values()];
 // process in batches to avoid overloading ESPN public endpoints
 for(let i=0;i<unique.length;i+=5){
  await Promise.all(unique.slice(i,i+5).map(async e=>{
   try{
    const summary=await load(BASE+'/summary?event='+encodeURIComponent(e.id));gamesAnalyzed++;
    for(const g of summary.boxscore?.players||[])for(const section of g.statistics||[]){
     const labels=section.labels||[];
     for(const a of section.athletes||[]){
      if(a.didNotPlay||a.active===false&&!a.stats?.length)continue;
      const key=normalize(a.athlete?.displayName),match=lookup.get(key);
      if(!match||!Array.isArray(a.stats)||!a.stats.length)continue;
      tally(match.player,stats(a,labels));
     }
    }
   }catch(err){fetchErrors.push({event:e.id,error:'box score unavailable'})}
  }));
 }
 const total=t=>{const s=zero();for(const p of t.players)for(const k of KEY)s[k]+=p.boxScore[k];return {...s,'FG%':ratio(s,'FGM','FGA'),'FT%':ratio(s,'FTM','FTA')}};
 const ours=total(our),theirs=total(opp);const categories=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
 const comparison=categories.map(c=>{const a=ours[c],b=theirs[c],who=a===null||b===null?'UNKNOWN':a===b?'TIE':c==='TO'?(a<b?'OURS':'OPPONENT'):(a>b?'OURS':'OPPONENT');return {category:c,ours:a,opponent:b,leader:who}});
 return {mode:'UNOFFICIAL_ALL_ROSTER_BOX_SCORES',observedAt:new Date().toISOString(),week:{start,end},source:'ESPN NBA public scoreboard and individual game boxscores',sourceUrl:'https://www.espn.com/nba/scoreboard',rosterSnapshotDate:'2026-10-22',opponentName:opp.name,ourTeamName:our.name,gamesAnalyzed,completedGamesFound:unique.length,fetchErrors,comparison,ourPlayers:our.players,opponentPlayers:opp.players,warning:'Not Yahoo matchup scoring. All players from dated roster snapshot counted when they appeared in NBA games, regardless of Yahoo starting/bench/IL or any roster changes. NBA stats may be corrected. Use Yahoo for official category score.'};
}
export default async function handler(req,res){
 try{const result=await buildMatchup();res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=300');res.status(200).json(result)}
 catch(e){res.status(503).json({error:'ESPN comparison unavailable',detail:String(e.message)})}
}
