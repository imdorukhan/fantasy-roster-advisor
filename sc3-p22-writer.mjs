import {supabaseRoots} from './sc3-supabase-ca.mjs';
import {authorized} from './sc3-yahoo-full-sync.mjs';
import {runP22Cycle} from './sc3-p22-cycle.mjs';
const project='bmsfbcuausbfzheufjtc',login='sc3_p2_runner',role='sc3_p2_writer';
export function writerConfig(env=process.env){
 if(env.VERCEL_ENV!=='production'||env.SC3_P2_COLLECT_ENABLED!=='1'||env.SC3_P2_COLLECT_WRITE!=='1'||env.SC3_SHARED_DB!=='1')throw Error('P2 writer disabled');
 let u;try{u=new URL(env.SC3_P2_WRITER_DATABASE_URL??'');}catch{throw Error('P2 writer URL unavailable');}
 const hosts={'db.bmsfbcuausbfzheufjtc.supabase.co':login,'aws-0-us-west-1.pooler.supabase.com':login+'.'+project};
 if(!['postgres:','postgresql:'].includes(u.protocol)||!hosts[u.hostname]||decodeURIComponent(u.username)!==hosts[u.hostname]||!u.password||u.pathname!=='/postgres'||u.search||u.hash||u.port&&u.port!=='5432')throw Error('P2 writer endpoint or role invalid');
 return {host:u.hostname,port:5432,user:hosts[u.hostname],password:decodeURIComponent(u.password),database:'postgres',ssl:{ca:supabaseRoots,rejectUnauthorized:true,minVersion:'TLSv1.2'},connectionTimeoutMillis:10000,statement_timeout:20000,max:1};
}
export async function makeWriterTransaction({env=process.env,pool}={}){
 const config=writerConfig(env);
 const p=pool??new (await import('pg')).Pool(config);
 const transaction=async fn=>{
  const c=await p.connect();
  try{
   await c.query('begin');
   await c.query('set local role sc3_p2_writer');
   await c.query('set local search_path to pg_catalog,sc3');
   const check=(await c.query("select session_user as login,current_user as role,exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','v','m') and (has_table_privilege(current_user,c.oid,'SELECT') or has_table_privilege(current_user,c.oid,'INSERT') or has_table_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE'))) as public_access,exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='sc3' and c.relname like 'yahoo_oauth_%' and (has_table_privilege(current_user,c.oid,'SELECT') or has_table_privilege(current_user,c.oid,'INSERT') or has_table_privilege(current_user,c.oid,'UPDATE') or has_table_privilege(current_user,c.oid,'DELETE'))) as oauth_access,has_table_privilege(current_user,'sc3.p2_matchup_forecasts','SELECT') as ledger_read,has_column_privilege(current_user,'sc3.p2_matchup_forecasts','id','INSERT') as ledger_insert,has_column_privilege(current_user,'sc3.p2_matchup_forecasts','captured_at','INSERT') as timestamp_insert")).rows[0];
   if(check?.login!==login||check.role!==role||check.public_access!==false||check.oauth_access!==false||check.ledger_read!==true||check.ledger_insert!==true||check.timestamp_insert!==false)throw Error('P2 writer isolation verification failed');
   const result=await fn(c);await c.query('commit');return result;
  }catch(e){try{await c.query('rollback');}catch{}throw e;}finally{c.release(true);}
 };
 return {transaction,close:()=>pool?Promise.resolve():p.end()};
}
// This route is inert until separately approved flags, dedicated login, and
// scheduler registration exist. No generic database writer or Preview writes.
export async function p22Cron(req,res,{env=process.env,makeWriter=makeWriterTransaction,collectors,run=runP22Cycle}={}){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
 if(env.VERCEL_ENV!=='production'||env.SC3_P2_COLLECT_ENABLED!=='1'||env.SC3_P2_COLLECT_WRITE!=='1'||env.SC3_SHARED_DB!=='1')return res.status(404).json({error:'P2 collection disabled'});
 if(!authorized(req,env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
 let writer;
 try{
  writer=await makeWriter({env});
  const result=await run({...collectors,writerTransaction:writer.transaction});
  const failed=Object.values(result).some(r=>r.status!=='COMPLETE'||r.unavailable?.length||r.reason);
  return res.status(failed?503:200).json({mode:'SC3_P22_COLLECTION',status:failed?'INCOMPLETE':'PASS',stages:result});
 }catch{return res.status(503).json({mode:'SC3_P22_COLLECTION',status:'FAILED',error:'Dedicated collection unavailable'});}
 finally{if(writer)await writer.close();}
}
