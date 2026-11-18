// Development collector: no production database writes, no Yahoo credentials.
// Run: node scripts/collect-nba-logs.mjs --date=20261116 --out=.cache/nba-logs
import fs from 'node:fs/promises';
import path from 'node:path';
import {ingestGameLogs,gameWindows} from '../nba-game-logs.mjs';
const args=Object.fromEntries(process.argv.slice(2).map(x=>x.replace(/^--/,'').split('=')));
const now=new Date();
const yesterday=new Date(now.getTime()-86400000).toISOString().slice(0,10).replaceAll('-','');
const date=args.date||yesterday;
if(!/^\d{8}$/.test(date))throw Error('Invalid date: use YYYYMMDD');
const dir=path.resolve(args.out||'.cache/nba-logs');
await fs.mkdir(dir,{recursive:true});
const result=await ingestGameLogs({dates:[date]});
const file=path.join(dir,date+'.json');
const temp=file+'.tmp';
if(!result.complete)throw Error('Incomplete collection: '+JSON.stringify(result.errors));
await fs.writeFile(temp,JSON.stringify(result));
await fs.rename(temp,file);
const files=(await fs.readdir(dir)).filter(x=>/^\d{8}\.json$/.test(x)).sort();
const byPlayer=new Map(),completeDays=[];
for(const name of files){
 const item=JSON.parse(await fs.readFile(path.join(dir,name),'utf8'));
 if(!item.complete||!Array.isArray(item.rows))continue;
 completeDays.push(name.slice(0,8));
 for(const row of item.rows){if(!byPlayer.has(row.espnId))byPlayer.set(row.espnId,[]);byPlayer.get(row.espnId).push(row)}
}
const report={source:'ESPN NBA completed box scores',generatedAt:new Date().toISOString(),completeDays,players:[...byPlayer].map(([espnId,logs])=>({espnId,name:logs.at(-1)?.name,windows:gameWindows(logs)}))};
await fs.writeFile(path.join(dir,'player-windows.json'),JSON.stringify(report));
console.log(JSON.stringify({date,events:result.completedEvents,rows:result.rows.length,players:byPlayer.size,days:completeDays.length,output:dir}));
