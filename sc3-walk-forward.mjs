import {availableHistory,validBox,RAW_KEYS} from './sc3-forecast.mjs';
import {withScopedTransaction} from './sc3-postgres.mjs';
const time=x=>Date.parse(x);
const average=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
// Conditional next appearance test, not a reconstructed fantasy week.
// Origin is tipoff. Only rows actually observed before that origin are features.
// Outcome rows may be observed later, but never used in the feature set.
export function walkForwardGameTest(rows,{asOf,minGames=3,window=10}={}){
 const end=time(asOf);
 if(!Number.isFinite(end)||!Number.isInteger(minGames)||minGames<3||!Number.isInteger(window)||window<minGames||window>30)throw Error('Invalid backtest options');
 const known=availableHistory(rows,asOf).filter(r=>r.stats.MIN>0&&r.espn_id&&r.event_id);
 const unique=new Set(),groups=new Map();
 for(const r of known){
  const k=r.espn_id+'|'+r.event_id;if(unique.has(k))throw Error('Duplicate backtest game');unique.add(k);
  if(!groups.has(r.espn_id))groups.set(r.espn_id,[]);groups.get(r.espn_id).push(r);
 }
 const keys=RAW_KEYS.filter(k=>!['FGM','FGA','FTM','FTA'].includes(k));
 const metrics=Object.fromEntries(keys.map(k=>[k,{absolute:0,baseline:0,brier:0,baselineBrier:0}]));
 let scored=0,skipped=0;
 for(const games of groups.values()){
  games.sort((a,b)=>time(a.tipoff)-time(b.tipoff));
  for(let i=0;i<games.length;i++){
   const outcome=games[i],origin=time(outcome.tipoff);
   const training=games.slice(0,i).filter(r=>time(r.observed_at)<origin&&time(r.tipoff)<origin);
   const sample=training.slice(-window);
   if(sample.length<minGames){skipped++;continue;}
   scored++;
   for(const k of keys){
    const mean=average(sample.map(r=>r.stats[k])),baseline=average(training.map(r=>r.stats[k]));
    const y=outcome.stats[k],threshold=baseline,actual=y>threshold?1:0;
    const p=sample.filter(r=>r.stats[k]>threshold).length/sample.length;
    const q=training.filter(r=>r.stats[k]>threshold).length/training.length;
    metrics[k].absolute+=Math.abs(y-mean);metrics[k].baseline+=Math.abs(y-baseline);
    metrics[k].brier+=(p-actual)**2;metrics[k].baselineBrier+=(q-actual)**2;
   }
  }
 }
 return {available:scored>0,asOf,scored,skipped,athletes:groups.size,model:'last 10 completed appearances',baseline:'expanding mean and empirical frequency',target:'next played game, not participation or matchup winner',metrics:keys.map(category=>({category,mae:scored?metrics[category].absolute/scored:null,baselineMae:scored?metrics[category].baseline/scored:null,brier:scored?metrics[category].brier/scored:null,baselineBrier:scored?metrics[category].baselineBrier/scored:null})),readOnly:true,calibratesMatchup:false};
}
export async function readGameBacktest({now=new Date(),transaction=withScopedTransaction}={}){
 const rows=await transaction(async c=>(await c.query(`select l.event_id,l.espn_id,l.tipoff::text,l.observed_at::text,l.stats
 from sc3.sc3_nba_game_logs l join sc3.sc3_nba_sync_days d using(game_day)
 where d.status='complete' and l.observed_at<=$1::timestamptz and d.observed_at<=$1::timestamptz
 and l.game_day >= (($1::timestamptz at time zone 'America/New_York')::date-45)
 order by l.espn_id,l.tipoff`,[now])).rows);
 return walkForwardGameTest(rows,{asOf:now.toISOString()});
}
