import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialMatchupFromScoreboard,YAHOO_STAT_IDS} from './yahoo-scoreboard.mjs';
import {categoryComparison} from './decision-core.mjs';
const ours={'FG%':.50,'FT%':.875,'3PM':3,PTS:44,REB:15,AST:13,STL:7,BLK:4,TO:3};
const opponent={'FG%':.48,'FT%':.850,'3PM':5,PTS:50,REB:20,AST:12,STL:4,BLK:2,TO:7};
const myKey='478.l.85892.t.5',theirKey='478.l.85892.t.8';
const comp=categoryComparison(ours,opponent);
function makeTeam(key,name,stats,points){
 return {team:[[{team_key:key},{team_id:key.split('.t.')[1]},{name}],{team_stats:{coverage_type:'week',week:'5',stats:Object.entries(YAHOO_STAT_IDS).map(([cat,id])=>({stat:{stat_id:id,value:String(stats[cat])}}))},team_points:{total:String(points)},team_remaining_games:{total:{remaining_games:25,completed_games:6}}}]};
}
function sample(){
 const winners=comp.rows.map(row=>({stat_winner:{stat_id:YAHOO_STAT_IDS[row.category],...(row.leader!=='TIE'?{winner_team_key:row.leader==='OURS'?myKey:theirKey}:{})}}));
 return {league:[{league_key:'478.l.85892'},{scoreboard:{0:{matchups:{'0':{matchup:{'0':{teams:{'0':makeTeam(myKey,'Salary CAPtain',ours,comp.score.ours),'1':makeTeam(theirKey,'Dynasty Reloaded',opponent,comp.score.opponent)}},week:'5',week_start:'2026-11-16',week_end:'2026-11-22',stat_winners:winners}}}}}}]};
}
const opts={observedAt:'2026-11-17T20:59:00Z',now:new Date('2026-11-17T21:00:00Z')};
test('official Yahoo API scoreboard picks team 5 and real opponent in week 5',()=>{
 const result=officialMatchupFromScoreboard(sample(),opts);
 assert.equal(result.week,5);assert.equal(result.weekVerified,true);assert.equal(result.opponent.key,theirKey);
 assert.equal(result.categories.length,9);assert.equal(result.score.ours+result.score.opponent+result.score.ties,9);assert.equal(result.executable,false);
});
test('reject stale matchup week and stale observations',()=>{
 const old=sample();old.league[1].scoreboard[0].matchups[0].matchup.week_start='2026-10-20';old.league[1].scoreboard[0].matchups[0].matchup.week_end='2026-10-26';
 assert.throws(()=>officialMatchupFromScoreboard(old,opts));
 assert.throws(()=>officialMatchupFromScoreboard(sample(),{...opts,observedAt:'2026-10-22T21:00:00Z'}));
});
test('require Yahoo winner cross-check and reject fabricated points',()=>{
 const wrong=sample();wrong.league[1].scoreboard[0].matchups[0].matchup.stat_winners[0].stat_winner.winner_team_key=theirKey;
 assert.throws(()=>officialMatchupFromScoreboard(wrong,opts));
 const wrongPoints=sample();wrongPoints.league[1].scoreboard[0].matchups[0].matchup['0'].teams['0'].team[1].team_points.total='9';
 assert.throws(()=>officialMatchupFromScoreboard(wrongPoints,opts));
});
test('reject partial or missing category values',()=>{
 const bad=sample();bad.league[1].scoreboard[0].matchups[0].matchup['0'].teams['0'].team[1].team_stats.stats.pop();
 assert.throws(()=>officialMatchupFromScoreboard(bad,opts));
});
