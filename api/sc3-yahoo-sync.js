import {fullSync} from '../sc3-yahoo-full-sync.mjs';
import {findTeams,findPlayers,read} from './auto-data.js';
import {loadBackgroundYahooSession} from './auth/yahoo/_store.js';
import {yahooSessionClient} from './auth/yahoo/_refresh.js';

export const config = {maxDuration:300};
export default function handler(req,res) {
  return fullSync(req,res,{
    loadSession:loadBackgroundYahooSession,
    createClient:owner=>yahooSessionClient(owner,{read:(token,path)=>read(token,path,{require200:true})}),
    findTeams,findPlayers
  });
}
