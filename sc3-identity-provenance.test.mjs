import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveVerifiedIdentity} from './sc3-identity-provenance.mjs';
test('persisted SC3 verified ESPN link is distinguished from read-only public Yahoo corroboration',()=>{
 const stored=resolveVerifiedIdentity('10452','5214640',[]);
 assert.equal(stored.espnId,'5214640');
 assert.equal(stored.source,'SC3_VERIFIED_LINK');
 assert.equal(stored.persisted,true);
 assert.equal(stored.readOnly,true);
 const transient=resolveVerifiedIdentity('10452',null,[{
  yahooId:'10452',espnId:'5214640',status:'verified',evidence:'unique normalized name + team + exact birth date'
 }]);
 assert.equal(transient.espnId,'5214640');
 assert.equal(transient.source,'YAHOO_PUBLIC_PROFILE_AND_ESPN_CATALOG');
 assert.equal(transient.persisted,false);
 assert.match(transient.yahooProfileUrl,/\/10452\/$/);
 assert.match(transient.espnProfileUrl,/\/5214640\//);
});
test('duplicate, wrong Yahoo ID or unverified public evidence cannot assert an ESPN link',()=>{
 const one={yahooId:'10452',espnId:'5214640',status:'verified',evidence:'unique normalized name + team + exact birth date'};
 const attempts=[[one,{...one,espnId:'999'}],[{...one,yahooId:'10453'}],[{...one,status:'candidate'}]];
 for(const candidates of attempts){
  const v=resolveVerifiedIdentity('10452',null,candidates);
  assert.equal(v.espnId,null);
  assert.equal(v.source,'UNRESOLVED');
  assert.equal(v.persisted,false);
 }
});
