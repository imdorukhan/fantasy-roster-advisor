import test from 'node:test';
import assert from 'node:assert/strict';
import {alertCandidates} from './strategy-core.mjs';
const now='2026-11-23T12:00:00Z';
const news={playerId:'10',important:true,verifiedSource:true,sourceUrl:'https://www.nba.com/news/player-status',observedAt:'2026-11-23T11:00:00Z',message:'Official status update'};
test('alerts require live Yahoo ownership, current dated source, and no conflicting player ownership',()=>{
 const roster=[{id:'10',name:'Prior Owner',ownership:'MY_TEAM',liveYahooVerified:false}];
 assert.deepEqual(alertCandidates({myRoster:roster,verifiedFreeAgents:[],news:[news],now}),[]);
 const conflict=alertCandidates({myRoster:[{id:'10',ownership:'MY_TEAM',liveYahooVerified:true}],
  verifiedFreeAgents:[{id:'10',availability:'FA',liveYahooVerified:true}],news:[news],now});
 assert.deepEqual(conflict,[]);
});
test('alerts reject undated or stale news and deduplicate the same important event',()=>{
 const fa=[{id:'10',availability:'FA',liveYahooVerified:true}];
 const rows=[{...news,observedAt:'2026-11-01T11:00:00Z'},{...news,sourceUrl:null},news,{...news}];
 const result=alertCandidates({myRoster:[],verifiedFreeAgents:fa,news:rows,now});
 assert.equal(result.length,1);
 assert.equal(result[0].scope,'VERIFIED_FA');
 assert.equal(result[0].deliveryEnabled,false);
 assert.equal(result[0].executable,false);
});
