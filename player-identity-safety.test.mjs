import test from 'node:test';
import assert from 'node:assert/strict';
import {matchPlayers} from './player-identity.mjs';
test('one Yahoo player ID cannot verify against two distinct ESPN identities',()=>{
 const yahoo=[
  {yahooId:'42',name:'Example Alpha',nbaTeam:'GSW',birthDate:'2002-02-02'},
  {yahooId:'42',name:'Example Beta',nbaTeam:'GSW',birthDate:'2001-01-01'}
 ];
 const espn=[
  {espnId:'400',name:'Example Alpha',team:'GS',birthDate:'2002-02-02'},
  {espnId:'401',name:'Example Beta',team:'GS',birthDate:'2001-01-01'}
 ];
 const results=matchPlayers(yahoo,espn);
 assert.equal(results.filter(x=>x.status==='verified').length,0);
 assert.equal(results.length,2);
 assert.ok(results.every(x=>x.status==='unresolved'&&x.espnId===null));
});
test('unique reciprocal ID match is preserved and a duplicate ESPN ID invalidates both',()=>{
 const result=matchPlayers(
  [{yahooId:'90',name:'Example One',nbaTeam:'SAS',birthDate:'2003-03-03'}],
  [{espnId:'900',name:'Example One',team:'SA',birthDate:'2003-03-03'}]
 );
 assert.equal(result[0].status,'verified');assert.equal(result[0].espnId,'900');
 const two=matchPlayers(
  [{yahooId:'90',name:'Example One',nbaTeam:'SAS',birthDate:'2003-03-03'},
   {yahooId:'91',name:'Example One',nbaTeam:'SAS',birthDate:'2003-03-03'}],
  [{espnId:'900',name:'Example One',team:'SA',birthDate:'2003-03-03'}]
 );
 assert.ok(two.every(x=>x.status==='unresolved'&&x.espnId===null));
});
