import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyMatchupSources} from './matchup-source-health.mjs';

test('owner 401 is never mislabeled as stale data',()=>{
 const state=classifyMatchupSources({officialHttpStatus:401,publicFresh:false});
 assert.equal(state.officialStatus,'OWNER SIGN-IN REQUIRED');
 assert.equal(state.requiresOwner,true);
 assert.equal(state.publicStatus,'UNAVAILABLE / STALE');
});
test('new-week 422 is not a successful official score',()=>{
 const state=classifyMatchupSources({officialHttpStatus:422,publicFresh:true});
 assert.equal(state.officialStatus,'CURRENT WEEK UNVERIFIED');
 assert.equal(state.weekUnverified,true);
 assert.equal(state.officialVerified,false);
 assert.equal(state.publicStatus,'FRESH');
});
test('server error does not imply login or valid score',()=>{
 const state=classifyMatchupSources({officialHttpStatus:503});
 assert.equal(state.officialStatus,'SOURCE UNAVAILABLE');
 assert.equal(state.requiresOwner,false);
});
test('verified official matchup supersedes error status',()=>{
 const state=classifyMatchupSources({officialVerified:true,officialHttpStatus:401});
 assert.equal(state.officialStatus,'VERIFIED');
 assert.equal(state.requiresOwner,false);
});

test('official week six can be verified while category totals remain pending',()=>{
 const state=classifyMatchupSources({officialHttpStatus:422,officialPending:true,publicFresh:false});
 assert.equal(state.officialStatus,'WEEK VERIFIED / CATEGORY TOTALS PENDING');
 assert.equal(state.weekUnverified,false);
 assert.equal(state.scorePending,true);
 assert.equal(state.officialVerified,false);
 assert.equal(state.publicStatus,'UNAVAILABLE / STALE');
});
