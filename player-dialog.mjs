const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cats=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
const fmt=(value,key)=>!Number.isFinite(value)?'—':key.endsWith('%')?(value*100).toFixed(1)+'%':Number(value.toFixed(1)).toString();
export function playerLink(player){
 const id=String(player.yahooId??player.playerId??player.id??'');
 return '<button type="button" class="player-profile-link" data-player-id="'+esc(/^\d{1,10}$/.test(id)?id:'')+'">'+esc(player.name)+'</button>';
}
function table(headers,rows){
 return '<div class="player-card-scroll"><table><thead><tr>'+headers.map(value=>'<th scope="col">'+esc(value)+'</th>').join('')+
  '</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map((value,index)=>index===0?'<th scope="row">'+esc(value)+'</th>':'<td>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
const score=value=>value?value.ours+'–'+value.opponent+'–'+value.ties:'Unavailable';
const sourceTime=value=>value?new Date(value).toLocaleString():'Unavailable';
function profileBody(data){
 const {profile:p,week,season}=data;
 const a=p.analytics;
 const sections=[];
 sections.push('<p>'+esc([p.nbaTeam,p.fantasyTeam,p.slot,p.yahooRosterStatus??p.ownership].filter(Boolean).join(' · '))+' · Yahoo observed '+esc(sourceTime(p.observedAt))+'</p>');
 const details=[['Yahoo ID',p.yahooId],['ESPN ID',p.espnId],['Yahoo injury flag',p.status],['Eligible positions',p.eligiblePositions?.map(pos=>typeof pos==='string'?pos:pos.position).filter(Boolean).join(', ')],['Yahoo rank',p.yahooRank],['Percent owned',p.percentOwned],
  ['Percent started',p.forecast?.percentStarted],['Next 7-day rank',p.forecast?.next7DayRank],['Next 14-day rank',p.forecast?.next14DayRank],['Rest-of-season rank',p.forecast?.restOfSeasonRank]];
 sections.push('<details open><summary>Player information</summary>'+table(['Field','Value'],details)+'</details>');
 if(a){
  const windows=[a.season,...[1,3,7,14].map(n=>a.windows[n])];
  const keys=['GP','MPG',...cats,'FGM','FGA','FTM','FTA','3PA','OREB','DREB','PF','DD','TD'];
  sections.push('<details><summary>ESPN production by sample</summary><p>Completed games through '+esc(p.historyThrough)+' · '+esc(a.signal.type.replaceAll('_',' '))+'</p>'+
   table(['Stat','Season ('+a.season.games+')','Last 1','Last 3','Last 7','Last 14'],keys.map(key=>[key,...windows.map(window=>window?.complete?fmt(window.values?.[key],key):'—')]))+'</details>');
  sections.push('<details><summary>Latest completed game logs</summary>'+table(['Date',...cats,'MIN','FGM','FGA','FTM','FTA'],a.chart.map(row=>[
   row.date.slice(0,10),...[...cats,'MIN','FGM','FGA','FTM','FTA'].map(key=>fmt(key==='FG%'?row.stats.FGA>0?row.stats.FGM/row.stats.FGA:null:key==='FT%'?row.stats.FTA>0?row.stats.FTM/row.stats.FTA:null:row.stats[key],key))
  ]))+'</details>');
 }else sections.push('<p>Verified ESPN player history unavailable.</p>');
 if(p.depth.length)sections.push('<details><summary>ESPN depth chart</summary>'+table(['Position','Rank','NBA team','Injury marker','Observed'],p.depth.map(row=>[row.position,row.rank,row.nba_team,row.injury_marker,sourceTime(row.observed_at)]))+'</details>');
 sections.push('<h3>Current matchup impact</h3><p>'+esc(week.reason||'Gross addition scenario. A corresponding drop or claim is separate.')+'</p>');
 if(Number.isInteger(week.rosteredStarts))sections.push('<p>Upcoming starts on your lineup: '+esc(week.rosteredStarts)+(week.dates?.length?' · '+esc(week.dates.join(', ')):'')+'</p>');
 else if(Number.isInteger(week.extraStarts))sections.push('<p>Estimated extra starts: '+esc(week.extraStarts)+(week.dates?.length?' · '+esc(week.dates.join(', ')):'')+'</p>');
 if(week.production)sections.push(table(['Category','Expected player contribution'],cats.map(key=>[key,fmt(week.production[key],key)])));
 if(week.score)sections.push('<p><strong>Week-end scenario: '+esc(score(week.score.before))+' → '+esc(score(week.score.after))+'</strong></p>'+
  table(['Category','Current lineup scenario','With player','Opponent'],week.score.changes.map(row=>[row.category,fmt(row.baseline,row.category),fmt(row.withPlayer,row.category),fmt(row.opponent,row.category)])));
 sections.push('<h3>Rest of fantasy season</h3>');
 if(season){
  sections.push('<p>'+esc(season.scheduledGames)+' ESPN games currently scheduled through Yahoo league end '+esc(season.yahooEnd)+'.</p>');
  if(season.production)sections.push('<p>Gross schedule scenario at the player’s verified season rate ('+esc(season.sampleGames)+' games). Lineup conflicts, injuries and a possible drop are excluded.</p>'+
   table(['Category','Player contribution if all scheduled games are played'],cats.map(key=>[key,fmt(season.production[key],key)])));
  else sections.push('<p>Verified season production unavailable.</p>');
  sections.push('<details><summary>Remaining scheduled dates</summary><p>'+esc(season.dates.join(', ')||'None')+'</p></details>');
 }else sections.push('<p>Verified season schedule unavailable.</p>');
 sections.push('<p><a href="https://basketball.fantasysports.yahoo.com/nba/85892/player/'+encodeURIComponent(p.yahooId)+'" target="_blank" rel="noopener noreferrer">View on Yahoo Fantasy ↗</a></p>');
 return sections.join('');
}
let dialog,controller;
function init(){
 if(dialog)return;
 const style=document.createElement('style');
 style.textContent='.player-profile-link{background:none;border:0;padding:0;color:inherit;font:inherit;font-weight:700;text-align:left;text-decoration:underline;text-underline-offset:3px;cursor:pointer}.player-profile-link:focus-visible{outline:2px solid #b5a9ff;outline-offset:3px}#sc3-player-dialog{box-sizing:border-box;width:min(760px,94vw);max-height:88dvh;overflow:auto;color:#edf1ff;background:#151d32;border:1px solid #485370;border-radius:16px;padding:16px}#sc3-player-dialog::backdrop{background:#0b1020bb}.player-card-header{display:flex;justify-content:space-between;align-items:center;gap:12px;position:sticky;top:0;background:#151d32;padding:8px 0;z-index:1}.player-card-header h2{margin:0}.player-card-close{padding:7px 12px;border:1px solid #7c70b5;border-radius:8px;background:#3d3268;color:white;cursor:pointer}.player-card-scroll{overflow:auto;margin:10px 0}.player-card-scroll table{width:100%;min-width:unset!important;border-collapse:collapse}.player-card-scroll th,.player-card-scroll td{font-size:13px;text-align:left!important;padding:7px;border-bottom:1px solid #34405b;white-space:nowrap}#sc3-player-dialog details{margin:12px 0}#sc3-player-dialog summary{cursor:pointer;font-weight:650}';
 document.head.append(style);
 dialog=document.createElement('dialog');
 dialog.id='sc3-player-dialog';
 dialog.setAttribute('aria-labelledby','sc3-player-name');
 dialog.innerHTML='<div class="player-card-header"><h2 id="sc3-player-name"></h2><button type="button" class="player-card-close">Close</button></div><div id="sc3-player-content" role="status"></div>';
 document.body.append(dialog);
 dialog.querySelector('button').addEventListener('click',()=>dialog.close());
 dialog.addEventListener('close',()=>controller?.abort());
}
document.addEventListener('click',async event=>{
 const button=event.target.closest?.('[data-player-id]');
 if(!button)return;
 init();
 controller?.abort();
 const current=new AbortController();
 controller=current;
 dialog.querySelector('h2').textContent=button.textContent.trim();
 const content=dialog.querySelector('#sc3-player-content');
 content.textContent='Checking verified player data and lineup impact…';
 if(!dialog.open)dialog.showModal();
 const id=button.dataset.playerId;
 if(!id){content.textContent='Verified Yahoo player ID unavailable.';return;}
 try{
  const response=await fetch('/api/auto-data?sc3Player=1&id='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store',signal:current.signal});
  const data=await response.json();
  if(!response.ok||data.mode!=='SC3_PLAYER_EVALUATION')throw Error(data.error||'Player evaluation unavailable');
  if(current.signal.aborted)return;
  dialog.querySelector('h2').textContent=data.profile.name;
  content.innerHTML=profileBody(data);
 }catch(error){if(!current.signal.aborted)content.textContent=error.message;}
});
