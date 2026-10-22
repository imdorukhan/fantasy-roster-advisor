// Local-only journal. It is intentionally NOT auto-populated from sources.
import fs from 'node:fs';
import {recordForecast,settleForecast,sourceReliability} from './source-reliability.mjs';
const path=process.env.INJURY_LEDGER_PATH||'data/injury-forecast-history.local.json';
const read=()=>fs.existsSync(path)?JSON.parse(fs.readFileSync(path,'utf8')):[];
const save=x=>{fs.mkdirSync('data',{recursive:true});const tmp=path+'.tmp';fs.writeFileSync(tmp,JSON.stringify(x,null,2)+'\n',{flag:'w'});fs.renameSync(tmp,path)};
const [command,arg1,arg2]=process.argv.slice(2);
try{
 if(command==='show')console.log(JSON.stringify({forecasts:read().length,sources:sourceReliability(read())},null,2));
 else if(command==='forecast'){if(!arg1)throw Error('Provide JSON file with sourced forecast');const entry=JSON.parse(fs.readFileSync(arg1,'utf8'));const next=recordForecast(read(),entry);save(next);console.log('Saved immutable prediction '+entry.forecastId)}
 else if(command==='settle'){if(!arg1||!arg2)throw Error('Provide forecast ID and JSON verified outcome file');const outcome=JSON.parse(fs.readFileSync(arg2,'utf8'));const next=settleForecast(read(),arg1,outcome);save(next);console.log('Settled '+arg1)}
 else throw Error('Usage: node injury-ledger.mjs show | forecast path.json | settle forecastId outcome.json');
}catch(err){console.error(err.message);process.exitCode=1}
