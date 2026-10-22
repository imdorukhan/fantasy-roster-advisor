const URL='https://basketball.fantasysports.yahoo.com/nba/85892/matchup?week=1&mid1=5&mid2=13';
const CATEGORIES=['FG%','FT%','3PTM','PTS','REB','AST','ST','BLK','TO'];
const strip=s=>String(s||'').replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim();
const tdValues=row=>[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>strip(m[1]));
export function parseYahooMatchup(html){
 const section=String(html).match(/<section\s+id=["']matchup-wall-header["'][\s\S]*?<\/section>/i)?.[0];
 if(!section)throw Error('Yahoo matchup stat table unavailable');
 const body=section.match(/<tbody>([\s\S]*?)<\/tbody>/i)?.[1];
 const rows=[...(body||'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m=>tdValues(m[1]));
 if(rows.length!==2||rows.some(r=>r.length<13))throw Error('Yahoo matchup stat rows incomplete');
 const parseRow=(r,id)=>{
  const name=r[0],numeric=x=>/^\.?\d+(?:\.\d+)?$/.test(x)?Number(x):null;
  const stats={FGMA:r[1],'FG%':numeric(r[2]),FTMA:r[3],'FT%':numeric(r[4]),'3PTM':numeric(r[5]),PTS:numeric(r[6]),REB:numeric(r[7]),AST:numeric(r[8]),ST:numeric(r[9]),BLK:numeric(r[10]),TO:numeric(r[11]),categoryWins:numeric(r[12])};
  if(Object.entries(stats).some(([key,value])=>!['FGMA','FTMA'].includes(key)&&value===null))throw Error('Yahoo matchup stat not numeric');
  return {id,name,stats};
 };
 const ours=parseRow(rows[0],5),opponent=parseRow(rows[1],13);
 if(!/Salary CAPtain/i.test(ours.name)||!/(Sabanoglu|Şabanoğlu)/i.test(opponent.name))throw Error('Unexpected team or opponent');
 const categories=CATEGORIES.map(c=>{const a=ours.stats[c],b=opponent.stats[c];return {category:c,ours:a,opponent:b,leader:a===b?'TIE':c==='TO'?(a<b?'OURS':'OPPONENT'):(a>b?'OURS':'OPPONENT'),gap:a-b}});
 const wins=categories.filter(c=>c.leader==='OURS').length,losses=categories.filter(c=>c.leader==='OPPONENT').length;
 if(wins!==ours.stats.categoryWins||losses!==opponent.stats.categoryWins)throw Error('Yahoo category wins mismatch');
 const context=strip(String(html).slice(Math.max(0,String(html).indexOf('matchup-wall-header')-2200),String(html).indexOf('matchup-wall-header')));
 const progress=context.match(/(\d+)\/(\d+) Games Played\s+(\d+)\/(\d+) Remaining/);
 return {source:'Yahoo Fantasy Basketball matchup page',sourceUrl:URL,week:1,ourTeam:ours,opponent,categories,score:{ours:wins,opponent:losses,ties:9-wins-losses},gameProgress:progress?{played:Number(progress[1]),scheduled:Number(progress[2]),remaining:Number(progress[3]),remainingScheduled:Number(progress[4])}:null,method:'Official Yahoo lineup-scored category totals, not full-roster NBA box scores'};
}
export default async function handler(req,res){
 try{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),9000);
  let response;try{response=await fetch(URL,{signal:controller.signal,headers:{'User-Agent':'Mozilla/5.0 (compatible; SalaryCaptainReadOnly/1.0)','Accept':'text/html'}})}finally{clearTimeout(timer)}
  if(!response.ok)throw Error('Yahoo HTTP '+response.status);
  const result=parseYahooMatchup(await response.text());
  result.retrievedAt=new Date().toISOString();
  res.setHeader('Cache-Control','s-maxage=180, stale-while-revalidate=180');
  return res.status(200).json(result);
 }catch(error){res.setHeader('Cache-Control','no-store');return res.status(503).json({error:'Live Yahoo matchup currently unavailable',reason:String(error.message),sourceUrl:URL})}
}
