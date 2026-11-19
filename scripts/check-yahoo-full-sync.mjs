// Runs the existing authorized API mode in a managed server environment.
const write = process.argv.includes('--write');
process.env.SC3_SHARED_DB = '1';
process.env.SC3_YAHOO_FULL_SYNC_ENABLED = '1';
process.env.SC3_YAHOO_FULL_SYNC_WRITE = write ? '1' : '0';

if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 32) {
  console.log('SC3_SYNC_LAUNCH ' + JSON.stringify({status: 'FAILED', category: 'cron_auth_not_configured', snapshotWrites: 0}));
  process.exit(1);
}

const {default: handler} = await import('../api/auto-data.js');
let result;
const response = {
  setHeader() {},
  status(code) { this.code = code; return this; },
  json(body) { result = body; return this; }
};
try {
  await handler({
    method: 'GET',
    query: {sc3YahooSync: '1'},
    headers: {authorization: 'Bearer ' + process.env.CRON_SECRET}
  }, response);
  const expectedStatus = write ? 'PASS' : 'VALIDATED';
  const expectedWrites = write ? 8 : 0;
  if (response.code !== 200 || result?.snapshotWrites !== expectedWrites || result?.status !== expectedStatus) {
    console.log('SC3_SYNC_LAUNCH ' + JSON.stringify({
      http: response.code, status: result?.status ?? 'FAILED',
      category: result?.category ?? 'sync_not_verified',
      snapshotWrites: result?.snapshotWrites ?? null
    }));
    process.exitCode = 1;
  }
} catch {
  console.log('SC3_SYNC_LAUNCH ' + JSON.stringify({status: 'FAILED', category: 'launcher_unavailable'}));
  process.exitCode = 1;
}
