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

test('one injury episode/status emits one candidate even if multiple verified sources repeat it',()=>{
 const owned=[{id:'10452',ownership:'MY_TEAM',liveYahooVerified:true}];
 const news=[
  {playerId:'10452',injuryEpisodeId:'hip-20261123',injuryStatus:'Q',important:true,verifiedSource:true,sourceUrl:'https://www.nba.com/news/update',observedAt:'2026-11-23T18:00:00Z',message:'Questionable'},
  {playerId:'10452',injuryEpisodeId:'hip-20261123',injuryStatus:'Q',important:true,verifiedSource:true,sourceUrl:'https://www.espn.com/nba/news/update',observedAt:'2026-11-23T18:10:00Z',message:'Still questionable'}
 ];
 const first=alertCandidates({myRoster:owned,news,now:'2026-11-23T18:30:00Z'});
 assert.equal(first.length,1);
 assert.equal(first[0].eventKey,'10452|hip-20261123|Q');
 const repeated=alertCandidates({myRoster:owned,news,now:'2026-11-23T18:30:00Z',deliveredEventKeys:[first[0].eventKey]});
 assert.equal(repeated.length,0,'A recorded status must not re-notify');
 const changed=alertCandidates({myRoster:owned,news:[{...news[1],injuryStatus:'O',message:'Now out'}],now:'2026-11-23T18:30:00Z',deliveredEventKeys:[first[0].eventKey]});
 assert.equal(changed.length,1);
 assert.notEqual(changed[0].eventKey,first[0].eventKey);
});
test('unverified source URLs with embedded credential hosts are rejected',()=>{
 const fa=[{id:'10452',availability:'FA',liveYahooVerified:true}];
 const event={playerId:'10452',important:true,verifiedSource:true,sourceUrl:'https://trusted.nba.com@other.example/news',observedAt:'2026-11-23T18:00:00Z',message:'Status'};
 assert.deepEqual(alertCandidates({verifiedFreeAgents:fa,news:[event],now:'2026-11-23T18:30:00Z'}),[]);
});
