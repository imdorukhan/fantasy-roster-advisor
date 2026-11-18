// Isolated-only backfill/daily runner. No credentials committed and no production reference accepted.
import {dateRange,devStore,syncDays} from '../nba-sync.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const eastern=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const yesterday=new Date(Date.parse(eastern+'T12:00:00Z')-86400000).toISOString().slice(0,10);
const end=args.end||yesterday,start=args.start||end;
if(end>yesterday)throw Error('Only completed calendar days may be collected');
const store=devStore({url:process.env.SC3_DEV_SUPABASE_URL,secret:process.env.SC3_DEV_SUPABASE_SECRET_KEY,expectedRef:process.env.SC3_DEV_SUPABASE_REF});
const result=await syncDays({days:dateRange(start,end),store});
console.log(JSON.stringify(result));
if(!result.complete)process.exitCode=1;
