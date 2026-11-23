// Read-only Yahoo collection pagination. A partial or repeated page is never certified complete.
export async function collectYahooPool({readPage,pageSize=25,maxPages=80}={}){
 if(typeof readPage!=='function'||!Number.isInteger(pageSize)||pageSize<1||pageSize>25||!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw Error('Invalid pagination options');
 const seen=new Map();let pages=0;
 for(let i=0;i<maxPages;i++){
  const start=i*pageSize;let page;
  try{page=await readPage(start,pageSize)}catch(e){return {complete:false,players:[...seen.values()],pages,error:'Yahoo page unavailable',failedStart:start,upstreamStatus:e.status??null}}
  if(!page||page.start!==start||!Array.isArray(page.players)||page.players.length>pageSize||page.count!==page.players.length)return {complete:false,players:[...seen.values()],pages,error:'Invalid Yahoo page',failedStart:start};
  const ids=page.players.map(p=>String(p?.yahooId??''));
  if(ids.some(id=>!/^\d+$/.test(id))||new Set(ids).size!==ids.length||ids.some(id=>seen.has(id)))return {complete:false,players:[...seen.values()],pages,error:'Duplicate or invalid player ID',failedStart:start};
  for(const p of page.players)seen.set(String(p.yahooId),p);
  pages++;
  if(page.players.length<pageSize)return {complete:seen.size>0,players:[...seen.values()],pages,error:seen.size?null:'Empty player pool'};
 }
 return {complete:false,players:[...seen.values()],pages,error:'Pagination safety limit'};
}
export function yahooPoolPath(leagueKey,start,count=25){
 if(!/^\d+\.l\.\d+$/.test(leagueKey)||!Number.isInteger(start)||start<0||start>2500||!Number.isInteger(count)||count<1||count>25)throw Error('Invalid Yahoo pool request');
 return 'league/'+leagueKey+'/players;start='+start+';count='+count+'?format=json';
}
