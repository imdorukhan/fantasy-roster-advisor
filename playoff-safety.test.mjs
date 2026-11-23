import test from 'node:test';
import assert from 'node:assert/strict';
import {playoffScheduleValue} from './strategy-core.mjs';
test('playoff schedule count is not inflated by duplicate ESPN game rows',()=>{
 const players=[{id:'10',name:'Test Player'}];
 const dates=['2027-03-20','2027-03-21'];
 const schedule=[
  {playerId:'10',date:'2027-03-20',eventId:'event123'},
  {playerId:'10',date:'2027-03-20',eventId:'event123'},
  {playerId:'10',date:'2027-03-21',eventId:'event124'}
 ];
 const result=playoffScheduleValue({players,schedule,dates});
 assert.equal(result[0].games,2);
 assert.equal(result[0].actionable,false);
 assert.equal(result[0].scheduleVerified,false);
});
test('playoff helper rejects impossible playoff calendar dates and overlapping duplicate players',()=>{
 assert.throws(()=>playoffScheduleValue({players:[{id:'10',name:'A'}],schedule:[],dates:['2027-02-30']}),/Valid playoff dates/);
 assert.throws(()=>playoffScheduleValue({players:[{id:'10',name:'A'},{id:'10',name:'A2'}],schedule:[],dates:['2027-03-20']}),/Unique player IDs/);
});
