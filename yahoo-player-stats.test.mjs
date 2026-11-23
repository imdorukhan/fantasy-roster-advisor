import {test} from 'node:test';
import assert from 'node:assert/strict';
import {statCategoryId,minuteValue,averageMinutesByPlayer} from './yahoo-player-stats.mjs';
const cats={game:{stat_categories:{stats:{0:{stat:{stat_id:2,name:'Minutes Played',abbr:'MIN'}},1:{stat:{stat_id:12,name:'Points',abbr:'PTS'}}}}}};
const players={league:{players:{
 0:{player:[[{player_id:'10277'},{name:{full:'Baylor Scheierman'}}],{player_stats:{coverage_type:'average_season',stats:[{stat:{stat_id:2,value:'21:30'}},{stat:{stat_id:12,value:'8.3'}}]}}]},
 1:{player:[[{player_id:'10555'},{name:{full:'Sample'}}],{player_stats:{coverage_type:'average_season',stats:[{stat:{stat_id:2,value:'33.4'}}]}}]},
 2:{player:[[{player_id:'10333'},{name:{full:'Other'}}],{player_stats:{stats:[{stat:{stat_id:2,value:'N/A'}}]}}]}
}}};
test('Yahoo minute ID resolved from game categories, independent of league scoring settings',()=>{assert.equal(statCategoryId(cats,['MIN','Minutes Played']),'2');assert.equal(statCategoryId(cats,['GP']),null)});
test('minute normalization accepts valid averages and rejects invalid times',()=>{assert.equal(minuteValue('21:30'),21.5);assert.equal(minuteValue('33.4'),33.4);assert.equal(minuteValue('21:99'),null);assert.equal(minuteValue('N/A'),null);assert.equal(minuteValue(null),null);assert.equal(minuteValue(''),null)});
test('per-player Yahoo average season stats join metadata and sibling stat payload',()=>{const r=averageMinutesByPlayer(players,'2');assert.equal(r.get('10277'),21.5);assert.equal(r.get('10555'),33.4);assert.equal(r.has('10333'),false);assert.equal(r.size,2)});
test('wrong stat ID and missing values never invent MPG',()=>{const r=averageMinutesByPlayer(players,'99');assert.equal(r.size,0)});
