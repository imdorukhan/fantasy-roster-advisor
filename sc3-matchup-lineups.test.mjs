import test from 'node:test';
import assert from 'node:assert/strict';
import {datedYahooRows} from './sc3-streaming-plan.mjs';
import {lineupSlots} from './sc3-matchup-lineups.mjs';

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
