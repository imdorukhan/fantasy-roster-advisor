process.env.SC3_SHARED_DB = '1';
process.env.SC3_DEPTH_SYNC_ENABLED = '1';
process.env.SC3_DEPTH_SYNC_WRITE = process.argv.includes('--write') ? '1' : '0';
const {default:handler} = await import('../api/auto-data.js');
let result;
const response = {setHeader(){},status(code){this.code=code;return this;},json(body){result=body;return this;}};
await handler({method:'GET',query:{sc3DepthSync:'1'},headers:{authorization:'Bearer '+process.env.CRON_SECRET}},response);
if (response.code !== 200 || !['VALIDATED','PASS'].includes(result?.status)) process.exitCode=1;
