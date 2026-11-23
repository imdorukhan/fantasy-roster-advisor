import {parseMatchup} from './matchup-data.mjs';
import {matchPlayers} from './player-identity.mjs';

const yahoo = 'https://basketball.fantasysports.yahoo.com/nba/85892/matchup';
const profiles = 'https://sports.yahoo.com/nba/players/';
const normalize = value => value.normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');

export function verifiedYahooPage(html, official, observedAt) {
 const selected = [...html.matchAll(/<option\b[^>]*value=['"]([^'"]+)['"][^>]*\bselected\s*>\s*Week\s+(\d+)\s*<\/option>/gi)];
 if (selected.length!==1 || Number(selected[0][2])!==official.week) throw Error('Yahoo page week not verified');
 const url=new URL(selected[0][1].replaceAll('&amp;','&'),yahoo);
 if(url.searchParams.get('week')!==String(official.week)||url.searchParams.get('mid1')!=='5') throw Error('Yahoo page matchup not verified');
 const {ours,opponent}=parseMatchup(html);
 if(ours.id!==official.ourTeam.id||opponent.id!==official.opponent.id) throw Error('Yahoo opponent changed');
 function team(source, identity){
  function pair(raw, category){
   const match=raw.match(/^(\d+)\s*\/\s*(\d+)$/);
   if(!match)throw Error('Yahoo page shooting attempts missing');
   const made=Number(match[1]),attempts=Number(match[2]);
   if(!Number.isSafeInteger(made)||!Number.isSafeInteger(attempts)||made>attempts||
      Math.abs((attempts?made/attempts:0)-source.stats[category])>0.00051)throw Error('Yahoo page shooting counts differ from percentage');
   return [made,attempts];
  }
  const [FGM,FGA]=pair(source.fieldGoals,'FG%');
  const [FTM,FTA]=pair(source.freeThrows,'FT%');
  return {...identity,stats:source.stats,shooting:{FGM,FGA,FTM,FTA}};
 }
 return {...official,observedAt,source:'Yahoo Fantasy Basketball matchup page',ourTeam:team(ours,official.ourTeam),opponent:team(opponent,official.opponent)};
}

export async function readYahooPageBaseline(official, now, fetcher=fetch) {
 const url=new URL(yahoo);
 for(const [key,value] of Object.entries({mid1:5,mid2:official.opponent.id,week:official.week}))url.searchParams.set(key,String(value));
 const response=await fetcher(url,{cache:'no-store',signal:AbortSignal.timeout(6500),redirect:'error'});
 if(!response.ok||Number(response.headers.get('age')||0)>300)throw Error('Yahoo matchup page unavailable');
 return verifiedYahooPage(await response.text(),official,now.toISOString());
}

export function yahooProfileBirth(html, name){
 const title=html.match(/<title>([^<]+)<\/title>/i)?.[1]?.split(' (')[0]
  ?.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,value)=>String.fromCodePoint(value[0].toLowerCase()==='x'?parseInt(value.slice(1),16):Number(value)))
  .replace(/&apos;|&#39;/g,"'");
 if(!title||normalize(title)!==normalize(name))return null;
 const dates=[...new Set([...html.matchAll(/\\"birthDate\\":\\"(\d{4}-\d{2}-\d{2})\\"/g)].map(m=>m[1]))];
 return dates.length===1?dates[0]:null;
}

export async function verifyMissingYahooPlayers(players,catalog,fetcher=fetch){
 const candidates=new Set(catalog.map(player=>normalize(player.name)));
 const pending=players.filter(player=>/^\d+$/.test(player.yahooId)&&candidates.has(normalize(player.name)));
 const evidence=[];
 for(let index=0;index<pending.length;index+=5){
  const batch=await Promise.allSettled(pending.slice(index,index+5).map(async player=>{
   const url=profiles+player.yahooId+'/';
   const response=await fetcher(url,{signal:AbortSignal.timeout(4800),redirect:'error'});
   if(!response.ok)return null;
   const birthDate=yahooProfileBirth(await response.text(),player.name);
   return birthDate?{...player,birthDate}:null;
  }));
  evidence.push(...batch.filter(x=>x.status==='fulfilled'&&x.value).map(x=>x.value));
 }
 return matchPlayers(evidence,catalog).filter(row=>row.status==='verified');
}
