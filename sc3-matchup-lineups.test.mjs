import test from 'node:test';
import assert from 'node:assert/strict';
import {datedYahooRows} from './sc3-streaming-plan.mjs';
import {lineupSlots,readMatchupLineups} from './sc3-matchup-lineups.mjs';

const day='2026-11-19';
const config=[{position:'PG',count:1,is_starting_position:1},{position:'BN',count:1,is_starting_position:0},{position:'IL',count:1,is_starting_position:0}];
const row=(id,slot,team)=>'<tr><td data-pos="'+slot+'"><a class="name" data-ys-playerid="'+id+'">Player '+id+'</a>'+(team?'<span class="Fz-xxs">'+team+' - PG</span>':'')+'</td></tr>';
const html="<option value='/nba/85892/8/team?&date="+day+"' selected >Thu</option>"+
 '<table id="statTable0"><tbody>'+row(1,'PG','GS')+row(2,'BN','GS')+row(3,'IL','LAL')+'</tbody></table>';
test('two players with the same upcoming NBA game retain their Yahoo slot assignments',()=>{
 const lineup=lineupSlots(datedYahooRows(html,day,8),config,new Set(['GSW']));
 assert.deepEqual(lineup.map(p=>[p.assignment,p.upcoming]),[['STARTER',true],['BENCH',true],['IL',false]]);
 assert.throws(()=>datedYahooRows(html,day,5),/date and team/);
});
test('failed slot coverage and duplicate IDs are rejected',()=>{
 const rows=datedYahooRows(html,day,8);
 assert.throws(()=>lineupSlots(rows.slice(1),config,new Set()),/coverage/);
 assert.throws(()=>lineupSlots(rows.map(r=>({...r,yahooId:'1'})),config,new Set()),/players/);
});

test('verified Week 6 lineups are independently available before Yahoo publishes 9-CAT totals',async()=>{
 const now=new Date('2026-11-23T13:00:00Z'),observed_at='2026-11-23T12:30:00Z';
 const team=key=>({team:[[{team_key:key},{name:'Verified '+key}],{team_stats:{stats:[]}}]});
 const snapshots={
  scoreboard:{observed_at,payload:{league:[{}, {scoreboard:{'0':{matchups:{
   '0':{matchup:{week:'6',week_start:'2026-11-23',week_end:'2026-11-29', '0':{
    teams:{'0':team('478.l.85892.t.5'),'1':team('478.l.85892.t.2')}
   },stat_winners:[]}}
  }}}}]}},
  settings:{observed_at,payload:{league:[{}, {settings:[{roster_positions:config.map(slot=>({roster_position:slot}))}]}]}}
 };
 const nowDates=Array.from({length:7},(_,i)=>new Date(Date.parse('2026-11-23T12:00:00Z')+i*86400000).toISOString().slice(0,10));
 const fetcher=async url=>{
  if(url.includes('site.api.espn.com')){
   const stamp=url.split('dates=')[1];
   const date=stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6,8);
   return {ok:true,redirected:false,json:async()=>({
    leagues:[{slug:'nba'}],events:[{date:date+'T20:00:00Z',status:{type:{state:'pre',name:'STATUS_SCHEDULED'}},
     competitions:[{competitors:[{team:{abbreviation:'GS'}},{team:{abbreviation:'MEM'}}]}]}]
   })};
  }
  const id=Number(url.match(/\/nba\/85892\/(\d+)\?/)?.[1]);
  const date=url.split('date=')[1];
  const rows='<tr><td data-pos="PG"><a class="name" data-ys-playerid="10001">G</a><span class="Fz-xxs">GS - PG</span></td></tr>' +
   '<tr><td data-pos="BN"><a class="name" data-ys-playerid="10002">B</a><span class="Fz-xxs">GS - PG</span></td></tr>' +
   '<tr><td data-pos="IL"><a class="name" data-ys-playerid="10003">I</a><span class="Fz-xxs">LAL - PG</span></td></tr>';
  return {ok:true,redirected:false,text:async()=>'<option value="/nba/85892/'+id+'/team?&date='+date+'" selected >Day</option><table id="statTable0"><tbody>'+rows+'</tbody></table>'};
 };
 const report=await readMatchupLineups({now,fetcher,includeProjection:true,loadSnapshots:async()=>snapshots});
 assert.equal(report.mode,'SC3_MATCHUP_LINEUPS');
 assert.equal(report.week,6);
 assert.equal(report.scoreVerified,false);
 assert.equal(report.complete,true);
 assert.deepEqual(report.teams.map(t=>t.id),[5,2]);
 assert.deepEqual(report.days.map(d=>d.date),nowDates);
 assert.equal(report.teams[0].players.find(p=>p.name==='G')?.games.length,7);
 assert.match(report.projection.blocked.join(' '),/Official Yahoo 9-CAT totals not yet verified/);
 assert.equal(report.projection.endOfWeek,null);
 let retries=0;
 const recovered=await readMatchupLineups({now,loadSnapshots:async()=>snapshots,fetcher:async url=>{
  if(url.includes('dates=20261127')&&++retries===1)return {ok:false,status:503,redirected:false};
  return fetcher(url);
 }});
 assert.equal(retries,2);assert.equal(recovered.complete,true);
 const missing=await readMatchupLineups({
  now,includeProjection:true,loadSnapshots:async()=>snapshots,
  fetcher:async url=>url.includes('/nba/85892/2?date=2026-11-23')
   ? {ok:false,redirected:false,status:403}
   : fetcher(url)
 });
 assert.equal(missing.complete,false);
 assert.equal(missing.days[0].lineups.find(team=>team.id===2).verified,false);
 assert.equal(missing.days[0].lineups.find(team=>team.id===5).verified,true);
 assert.equal(missing.scoreVerified,false);
 assert.equal(missing.projection.endOfWeek,null);
});
