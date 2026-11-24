import {test} from 'node:test';
import assert from 'node:assert/strict';
import {officialMatchupFromScoreboard,currentMatchupIdentityFromScoreboard,YAHOO_STAT_IDS} from './yahoo-scoreboard.mjs';
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

function weekSixUnscored(){
 const raw=sample();
 const m=raw.league[1].scoreboard[0].matchups[0].matchup;
 m.week='6';m.week_start='2026-11-23';m.week_end='2026-11-29';m.status='midevent';
 m['0'].teams['1'].team[0].find(x=>x.team_key).team_key='478.l.85892.t.2';
 m['0'].teams['1'].team[0].find(x=>x.name).name='Week Six Opponent';
 for(const id of ['0','1']){
  const team=m['0'].teams[id].team[1];
  team.team_stats.week='6';
  for(const row of team.team_stats.stats)row.stat.value='';
  team.team_points.total='0';
 }
 m.stat_winners=Object.values(YAHOO_STAT_IDS).map(id=>({stat_winner:{stat_id:id}}));
 return raw;
}
const weekSixOptions={observedAt:'2026-11-23T11:02:21Z',now:new Date('2026-11-23T12:00:00Z')};
test('week six exists on Monday even when Yahoo has not published any 9-CAT totals',()=>{
 const raw=weekSixUnscored();
 // The actual 2026-11-23 league 85892 snapshot has Week 6, team #5 versus #2,
 // all nine weekly stat values empty, and no nine-category winners.
 assert.throws(()=>officialMatchupFromScoreboard(raw,weekSixOptions),/Yahoo current-week category totals not published/);
});

test('week 6 opponent and dates are verifiable without inventing Yahoo scores',()=>{
 const identity=currentMatchupIdentityFromScoreboard(weekSixUnscored(),weekSixOptions);
 assert.equal(identity.week,6);
 assert.equal(identity.weekStart,'2026-11-23');
 assert.equal(identity.weekEnd,'2026-11-29');
 assert.equal(identity.ourTeam.id,5);
 assert.equal(identity.opponent.id,2);
 assert.equal(identity.opponent.name,'Week Six Opponent');
 assert.equal(identity.weekVerified,true);
 assert.equal(identity.scoreVerified,false);
 assert.equal(identity.readOnly,true);
 assert.equal('score' in identity,false);
});
test('opponent selection requires exactly one valid current-week fixture',()=>{
 const repeated=weekSixUnscored();
 repeated.league[1].scoreboard[0].matchups[1]={matchup:structuredClone(repeated.league[1].scoreboard[0].matchups[0].matchup)};
 assert.throws(()=>currentMatchupIdentityFromScoreboard(repeated,weekSixOptions),/Exactly one official current Yahoo matchup required/);
 const stale=weekSixUnscored();
 assert.throws(()=>currentMatchupIdentityFromScoreboard(stale,{...weekSixOptions,observedAt:'2026-11-30T11:59:00Z',now:new Date('2026-11-30T12:00:00Z')}),/current Yahoo matchup required/);
});

test('official 9-CAT shooting percentages must agree with published makes and attempts',()=>{
 const withShooting=sample();
 const fixture=withShooting.league[1].scoreboard[0].matchups[0].matchup['0'].teams;
 for(const [index,fg,ft] of [['0','10/20','7/8'],['1','12/25','17/20']]){
  const stats=fixture[index].team[1].team_stats.stats;
  stats.push({stat:{stat_id:'9004003',value:fg}},{stat:{stat_id:'9007006',value:ft}});
 }
 const accepted=officialMatchupFromScoreboard(withShooting,opts);
 assert.equal(accepted.ourTeam.shooting.FGM,10);
 const badFg=structuredClone(withShooting);
 const own=badFg.league[1].scoreboard[0].matchups[0].matchup['0'].teams['0'].team[1].team_stats.stats;
 own.find(r=>r.stat.stat_id==='9004003').stat.value='10/30';
 assert.throws(()=>officialMatchupFromScoreboard(badFg,opts),/shooting.*percentage|FG%.*/i);
 const badFt=structuredClone(withShooting);
 const other=badFt.league[1].scoreboard[0].matchups[0].matchup['0'].teams['1'].team[1].team_stats.stats;
 other.find(r=>r.stat.stat_id==='9007006').stat.value='17/40';
 assert.throws(()=>officialMatchupFromScoreboard(badFt,opts),/shooting.*percentage|FT%.*/i);
 const partial=structuredClone(withShooting);
 partial.league[1].scoreboard[0].matchups[0].matchup['0'].teams['1'].team[1].team_stats.stats=
  partial.league[1].scoreboard[0].matchups[0].matchup['0'].teams['1'].team[1].team_stats.stats.filter(r=>r.stat.stat_id!=='9007006');
 assert.throws(()=>officialMatchupFromScoreboard(partial,opts),/shooting/);
});

test('unreal Yahoo week calendar dates must not qualify as verified current matchup',()=>{
 for(const [field,value] of [['week_end','2026-11-31'],['week_start','2026-11-00'],['week_end','2026-11-99']]){
  const broken=weekSixUnscored();
  broken.league[1].scoreboard[0].matchups[0].matchup[field]=value;
  assert.throws(
   ()=>currentMatchupIdentityFromScoreboard(broken,weekSixOptions),
   /current Yahoo matchup required|Yahoo matchup.*unavailable|Yahoo.*date/i,
   field+'='+value+' is not a real calendar date'
  );
 }
});
