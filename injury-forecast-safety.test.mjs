import test from 'node:test';
import assert from 'node:assert/strict';
import {recordForecast,settleForecast,sourceReliability} from './source-reliability.mjs';
const entry=(id,day,episode='episode-a')=>({forecastId:id,source:'official_nba',player:'Player X',
 injuryEpisodeId:episode,publishedAt:day,predictedReturn:'2026-12-10',url:'https://nba.com/test'});
test('forecast ledger rejects impossible calendar dates and missing episode identity',()=>{
 assert.throws(()=>recordForecast([],{...entry('id1','2026-11-23'),predictedReturn:'2026-11-31'}),/Incomplete sourced forecast/);
 assert.throws(()=>recordForecast([],{...entry('id1','2026-11-23'),injuryEpisodeId:undefined}),/Incomplete sourced forecast/);
 assert.throws(()=>settleForecast(recordForecast([],entry('id2','2026-11-23')),'id2',
  {actualReturn:'2026-11-31',actualEvidence:'https://nba.com/game',verifiedAt:'2026-12-01'}),/Verified game appearance/);
});
test('injury source accuracy cannot cherry-pick a later settled revision while first forecast remains unsettled',()=>{
 let ledger=recordForecast([],entry('first','2026-11-23'));
 ledger=recordForecast(ledger,entry('revision','2026-11-24'));
 ledger=settleForecast(ledger,'revision',{actualReturn:'2026-12-10',actualEvidence:'https://nba.com/game',verifiedAt:'2026-12-11'});
 assert.equal(sourceReliability(ledger).official_nba,undefined);
 ledger=settleForecast(ledger,'first',{actualReturn:'2026-12-10',actualEvidence:'https://nba.com/game',verifiedAt:'2026-12-11'});
 assert.equal(sourceReliability(ledger).official_nba.sampleSize,1);
});
