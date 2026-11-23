import {withScopedTransaction} from './sc3-postgres.mjs';
export const bridgeEnabled=(env=process.env)=>env.VERCEL_ENV==='preview'&&env.SC3_SHARED_DB==='1'&&env.SC3_YAHOO_BRIDGE==='1';
export const sc3ProductionEnabled=(env=process.env)=>env.VERCEL_ENV==='production'&&
 env.SC3_ISOLATED!=='1'&&env.SC3_SHARED_DB==='1'&&env.SC3_PRODUCTION_READS==='1';
export async function bridgeSnapshots({pool}={}){
 if(!bridgeEnabled()&&!sc3ProductionEnabled())throw Error('Yahoo bridge disabled');
 const rows=await withScopedTransaction(async c=>(await c.query("select section,payload,observed_at::text,source from sc3.yahoo_league_snapshots where league_id=85892 and source='Yahoo Fantasy Sports API' and section in ('settings','teams','standings','scoreboard','roster')")).rows,{pool});
 return Object.fromEntries(rows.map(r=>[r.section,r]));
}
