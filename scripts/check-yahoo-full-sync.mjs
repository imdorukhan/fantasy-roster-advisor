process.env.SC3_SHARED_DB='1';process.env.SC3_YAHOO_FULL_SYNC_ENABLED='1';process.env.SC3_YAHOO_FULL_SYNC_WRITE='0';
if(!process.env.CRON_SECRET||process.env.CRON_SECRET.length<32){console.log('SC3_DRY_RUN_LAUNCH '+JSON.stringify({status:'FAILED',category:'cron_auth_not_configured',snapshotWrites:0}));process.exit(1)}
const {default:handler}=await import('./api/auto-data.js');
let result;
const res={setHeader(){},status(code){this.code=code;return this},json(body){result=body;return this}};
try{await handler({method:'GET',query:{sc3YahooSync:'1'},headers:{authorization:'Bearer '+process.env.CRON_SECRET}},res);
if(result?.snapshotWrites!==0||result?.status!=='VALIDATED'){console.log('SC3_DRY_RUN_LAUNCH '+JSON.stringify({http:res.code,status:result?.status??'FAILED',category:result?.category??'dry_run_not_validated',snapshotWrites:result?.snapshotWrites??null}));process.exitCode=1}}
catch{console.log('SC3_DRY_RUN_LAUNCH '+JSON.stringify({status:'FAILED',category:'launcher_unavailable',snapshotWrites:0}));process.exitCode=1}
