// Public, read-only integration health. Never exposes OAuth tokens or credentials.
const BASE='https://salarycaptain.vercel.app';
async function probe(path,validate){
  try{
    const response=await fetch(BASE+path,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000),cache:'no-store'});
    if(!response.ok)return {ok:false,httpStatus:response.status};
    const body=await response.json();
    return {ok:Boolean(validate(body)),httpStatus:response.status};
  }catch{return {ok:false,httpStatus:null}}
}
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end()}
  const [oauth,rosters,matchup]=await Promise.all([
    probe('/api/auth/yahoo/status',d=>typeof d.configured==='boolean'&&typeof d.connected==='boolean'),
    probe('/api/auto-data',d=>d.coverage?.yahooOurRoster===true&&d.coverage?.yahooOpponentRoster===true&&d.coverage?.espnDatesFetched===d.coverage?.espnDatesRequested),
    probe('/api/yahoo-matchup',d=>d.categories?.length===9&&d.ourTeam?.id===5)
  ]);
  // A healthy public reader does not imply authenticated Yahoo Fantasy API access.
  return res.status(200).json({checkedAt:new Date().toISOString(),status:oauth.ok&&rosters.ok&&matchup.ok?'public_readers_operational':'degraded',checks:{oauthEndpoint:oauth,publicRosters:rosters,officialMatchup:matchup},note:'OAuth endpoint availability is not proof of Yahoo Fantasy API permission. See /api/auth/yahoo/status in your signed-in browser.'});
}
