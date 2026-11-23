import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const cli=new URL('./injury-ledger.mjs',import.meta.url).pathname;
test('local injury ledger respects a nested custom path without activating delivery',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sc3-injury-ledger-'));
 try {
  const file=path.join(tmp,'nested','history','predictions.json');
  const fixture=path.join(tmp,'source.json');
  fs.writeFileSync(fixture,JSON.stringify({
   forecastId:'fixture-1',source:'example_source',player:'Example',
   injuryEpisodeId:'episode-1',publishedAt:'2026-11-23',
   predictedReturn:'2026-11-28',url:'https://example.com/injury'
  }));
  const env={...process.env,INJURY_LEDGER_PATH:file};
  const call=(...args)=>spawnSync(process.execPath,[cli,...args],{cwd:tmp,env,encoding:'utf8'});
  const saved=call('forecast',fixture);
  assert.equal(saved.status,0,saved.stderr);
  assert.ok(fs.existsSync(file),'Custom path must be created');
  const show=call('show');
  assert.equal(show.status,0,show.stderr);
  assert.equal(JSON.parse(show.stdout).forecasts,1);
  const duplicate=call('forecast',fixture);
  assert.notEqual(duplicate.status,0,'Same prediction must not overwrite the ledger');
  assert.equal(JSON.parse(fs.readFileSync(file)).length,1);
 } finally {fs.rmSync(tmp,{recursive:true,force:true});}
});
