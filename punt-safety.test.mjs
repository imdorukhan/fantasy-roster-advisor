import test from 'node:test';
import assert from 'node:assert/strict';
import {puntSimulation} from './strategy-core.mjs';
const nine=['FG%','FT%','3PM','PTS','REB','AST','STL','BLK','TO'];
test('Punt Strategy must reject nine non-9-CAT probability keys',()=>{
 const wrong=Object.fromEntries(['FT%','3PM','PTS','REB','AST','STL','BLK','TO','FOULS'].map(k=>[k,.6]));
 assert.throws(()=>puntSimulation({categoryWinProbabilities:wrong,puntCategory:'TO'}),/Nine official 9-CAT probabilities required/);
});
test('Punt Strategy remains illustrative even when nine numeric inputs are supplied',()=>{
 const r=puntSimulation({categoryWinProbabilities:Object.fromEntries(nine.map(k=>[k,.6])),puntCategory:'TO'});
 assert.equal(r.retainedExpectedWins,4.8);
 assert.equal(r.actionable,false);
 assert.equal(r.calibrated,false);
 assert.equal(r.winProbability,null);
});
