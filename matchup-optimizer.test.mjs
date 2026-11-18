import test from 'node:test';
import assert from 'node:assert/strict';
import {officialMatchupView} from './decision-core.mjs';

const now=Date.parse('2026-11-18T08:00:00Z');
const stats={'FG%':0.5,'FT%':0.875,'3PM':3,PTS:44,REB:15,AST:13,STL:7,BLK:4,TO:3};
const opponentStats={'FG%':0.472,'FT%':0.7,'3PM':4,PTS:45,REB:21,AST:8,STL:2,BLK:0,TO:1};
const snapshot={mode:'YAHOO_OFFICIAL_MATCHUP',leagueId:85892,week:5,weekVerified:true,
 weekStart:'2026-11-16',weekEnd:'2026-11-22',observedAt:'2026-11-17T21:24:50Z',
 ourTeam:{id:5,name:'Our Team',stats,remainingGames:'34'},
 opponent:{id:8,name:'Opponent',stats:opponentStats,remainingGames:32},
 score:{ours:5,opponent:4,ties:0}};

test('verified current Yahoo snapshot shows the matchup and trailing turnover margin',()=>{
 const view=officialMatchupView(snapshot,{now});
 assert.equal(view.usable,true);
 assert.equal(view.rows.length,9);
 assert.deepEqual(view.remainingGames,{ours:34,opponent:32});
 assert.equal(view.targets.find(t=>t.category==='TO').gap,2);
});
test('missing remaining games are unknown and official validation fails closed',()=>{
 assert.equal(officialMatchupView({...snapshot,opponent:{...snapshot.opponent,remainingGames:null}},{now}).remainingGames.opponent,null);
 assert.equal(officialMatchupView({...snapshot,weekVerified:false},{now}).usable,false);
 assert.equal(officialMatchupView({...snapshot,score:{ours:4,opponent:5,ties:0}},{now}).usable,false);
 assert.equal(officialMatchupView(snapshot,{now:now+31*3600_000}).usable,false);
});
