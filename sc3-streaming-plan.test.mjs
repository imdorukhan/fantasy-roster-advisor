import test from 'node:test';
import assert from 'node:assert/strict';
import {openYahooSlots, rankStreamingFits, upcomingTeams} from './sc3-streaming-plan.mjs';

const date = '2026-11-19';
const day = (slot, team) => ({date, openSlots: [slot], teams: new Set([team])});
const player = (id,name,team,positions) => ({yahooId:id,name,nbaTeam:team,eligiblePositions:positions});

test('only eligible scheduled players fit explicitly open starting slots', () => {
  const players = [player('1','Guard','GSW',['PG']),player('2','Center','GSW',['C']),player('3','Off Day','LAL',['SG'])];
  const result = rankStreamingFits(players,[day('G','GSW')],{remaining:1});
  assert.deepEqual(result.shortlist.map(p=>[p.playerId,p.eligibleGames]),[['1',1]]);
  assert.deepEqual(rankStreamingFits(players,[day('G','GSW')],{remaining:0}).shortlist,[]);
  assert.deepEqual(rankStreamingFits(players,[{...day('G','GSW'),openSlots:[]}],{remaining:1}).shortlist,[]);
});
test('lineup slots require matching date, team, capacity and explicit empty marker', () => {
  const roster = "<option value='/nba/85892/5/team?&date=2026-11-19&stat1=S' selected    >Thu</option>"+
    '<table id="statTable0"><tbody><tr><td data-pos="Util"><a data-ys-playerid="1">Player</a></td></tr>'+
    '<tr><td data-pos="Util">(Empty)</td></tr></tbody></table>';
  const starters = [{position:'Util',count:2}];
  assert.deepEqual(openYahooSlots(roster,date,starters),['Util']);
  assert.throws(()=>openYahooSlots(roster,'2026-11-20',starters));
  assert.throws(()=>openYahooSlots(roster.replace('(Empty)','unverified'),date,starters));
});
test('ESPN schedule uses Pacific date and excludes started or non-scheduled games', () => {
  const game = {date:'2026-11-20T01:00Z',status:{type:{state:'pre',name:'STATUS_SCHEDULED'}},
    competitions:[{competitors:[{team:{abbreviation:'GS'}},{team:{abbreviation:'MEM'}}]}]};
  const feed = {leagues:[{slug:'nba'}],events:[game]};
  assert.deepEqual([...upcomingTeams(feed,date,new Date('2026-11-20T00:00Z')).teams],['GSW','MEM']);
  assert.equal(upcomingTeams(feed,date,new Date('2026-11-20T01:00Z')).teams.size,0);
  assert.throws(()=>upcomingTeams(feed,'2026-11-20',new Date('2026-11-20T00:00Z')));
});

import {yahooWindow} from './sc3-streaming-plan.mjs';

test('week six acquisition budget is readable before Yahoo publishes 9-CAT totals',()=>{
 const timestamp='2026-11-23T12:00:00.000Z';
 const team=key=>({team:[[{team_key:key},{name:key}],{team_stats:{stats:[]},team_points:{total:'0'}}]});
 const rows={
  scoreboard:{observed_at:timestamp,payload:{league:[{},{scoreboard:{'0':{matchups:{'0':{matchup:{
   week:'6',week_start:'2026-11-23',week_end:'2026-11-29',
   '0':{teams:{'0':team('478.l.85892.t.5'),'1':team('478.l.85892.t.2')}},
   stat_winners:[]
  }}}}}}]}},
  roster:{observed_at:timestamp,payload:{team:[[{team_key:'478.l.85892.t.5'},{roster_adds:{value:'0',coverage_type:'week',coverage_value:6}}]]}},
  settings:{observed_at:timestamp,payload:{league:[{},{settings:[{max_weekly_adds:'7',roster_positions:[{roster_position:{position:'PG',count:1,is_starting_position:1}}]}]}]}}
 };
 const window=yahooWindow(rows,new Date('2026-11-23T13:00:00.000Z'));
 assert.equal(window.week,6);
 assert.equal(window.matchup.opponent.id,2);
 assert.equal(window.matchup.scoreVerified,false);
 assert.equal(window.acquisitions.remaining,7);
 assert.equal(window.start,'2026-11-23');
 assert.equal(window.end,'2026-11-29');
 const wrongAdds=structuredClone(rows);
 wrongAdds.roster.payload.team[0][1].roster_adds.coverage_value=5;
 assert.throws(()=>yahooWindow(wrongAdds,new Date('2026-11-23T13:00:00.000Z')),/weekly acquisitions/);
 const duplicates=structuredClone(rows);
 duplicates.scoreboard.payload.league[1].scoreboard['0'].matchups['1']=structuredClone(duplicates.scoreboard.payload.league[1].scoreboard['0'].matchups['0']);
 assert.throws(()=>yahooWindow(duplicates,new Date('2026-11-23T13:00:00.000Z')),/Exactly one official current Yahoo matchup required/);
});
