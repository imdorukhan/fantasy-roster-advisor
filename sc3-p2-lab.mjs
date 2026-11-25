import {withScopedTransaction} from './sc3-postgres.mjs';
import {readReturnLedger} from './sc3-return-store.mjs';
import {readGameBacktest} from './sc3-walk-forward.mjs';
import {fetchEspnInjuryFeed} from './sc3-injury-feed.mjs';
import {forecastsFromEspn} from './sc3-return-ledger.mjs';
import {readCBSInjuries} from './sc3-cbs-injuries.mjs';
import {readOfficialInjuries} from './sc3-nba-official-injuries.mjs';
import {readCBSBoundMetrics} from './sc3-cbs-settlement.mjs';
import {readHistoricalCoverage} from './sc3-final-archive.mjs';
import {readP22Evidence} from './sc3-p22-source-diagnostics.mjs';
export const readInjuryCatalog=()=>withScopedTransaction(async c=>(await c.query('select espn_id as "espnId",name,nba_team as team from sc3.espn_player_identity')).rows);
// Only network-only work overlaps DB reads; both injury sources use the same
// verified catalog, and no external request is awaited inside a transaction.
export async function readP2Lab({history=readHistoricalCoverage,catalog=readInjuryCatalog,ledgerRead=readReturnLedger,backtestRead=readGameBacktest,espn=fetchEspnInjuryFeed,cbsRead=readCBSInjuries,nbaRead=readOfficialInjuries,cbsMetricsRead=readCBSBoundMetrics}={}){
 const feedPromise=Promise.resolve().then(espn).catch(()=>null);
 const historyResult=await readP22Evidence(history);
 const catalogResult=await readP22Evidence(catalog);
 const nbaPromise=catalogResult.data?readP22Evidence(()=>nbaRead({catalog:catalogResult.data})):Promise.resolve({data:null,failure:catalogResult.failure});
 const cbsPromise=catalogResult.data?Promise.resolve().then(()=>cbsRead({catalog:catalogResult.data})).catch(()=>null):Promise.resolve(null);
 const ledger=await ledgerRead();
 const backtest=await backtestRead();
 const cbsMetrics=await cbsMetricsRead();
 const [feed,cbs,nbaResult]=await Promise.all([feedPromise,cbsPromise,nbaPromise]);
 const nba=nbaResult.data,historyCoverage=historyResult.data;
 const candidates=feed?forecastsFromEspn(feed,new Date().toISOString()):[];
 return {mode:'SC3_P2_LAB',ledger,backtest,injuryPreview:{observedAt:feed?.observedAt??null,candidateCount:candidates.length,source:'ESPN',persisted:false},cbsEvidence:cbs?{source:cbs.source,observedAt:cbs.observedAt,teamGroups:cbs.teamGroups,parsed:cbs.parsed,matched:cbs.rows.length,lowerBounds:cbs.rows.filter(p=>p.earliestReturn).length,rows:cbs.rows,persisted:false}:null,nbaOfficialEvidence:nba?{...nba,persisted:false}:null,cbsMetrics,historyCoverage,nbaOfficialFailure:nbaResult.failure,historyCoverageFailure:historyResult.failure,snapshotWrites:0,readOnly:true};
}
