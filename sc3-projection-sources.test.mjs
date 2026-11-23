import test from 'node:test';
import assert from 'node:assert/strict';
import {verifiedYahooPage,yahooProfileBirth,verifyMissingYahooPlayers} from './sc3-projection-sources.mjs';

const official={week:5,ourTeam:{id:5,name:'Salary CAPtain'},opponent:{id:8,name:'Opponent'}};
const row=(id,name)=>'<tr><td><a href="/nba/85892/'+id+'">'+name+'</a></td>'+['10/20','.500','4/5','.800','2','22','9','4','2','1','3','5'].map(v=>'<td>'+v+'</td>').join('')+'</tr>';
const matchup="<option value='?week=5&amp;mid1=5' selected >Week 5</option>"+
 '<table><tr><th>FGM/A</th></tr>'+row(5,'Salary CAPtain')+row(8,'Opponent')+'</table>';
test('fresh Yahoo matchup page must match the official week and opponent',()=>{
 const baseline=verifiedYahooPage(matchup,official,'2026-11-18T09:00:00Z');
 assert.equal(baseline.ourTeam.shooting.FGA,20);
 assert.throws(()=>verifiedYahooPage(matchup,{...official,week:6},'now'),/week/);
 assert.throws(()=>verifiedYahooPage(matchup,{...official,opponent:{id:4}},'now'),/opponent/);
 assert.throws(()=>verifiedYahooPage(matchup.replace('.500','.450'),official,'now'),/shooting/);
});
test('new identity requires the Yahoo profile name, unique birth date and ESPN team match',async()=>{
 const html=String.raw`<title>Example (PG) - Yahoo Sports</title>\"birthDate\":\"2000-04-20\"`;
 const yahoo=[{yahooId:'1',name:'Example',nbaTeam:'GSW'}];
 const espn=[{espnId:'2',name:'Example',team:'GS',birthDate:'2000-04-20'}];
 const fetcher=async()=>({ok:true,text:async()=>html});
 assert.equal(yahooProfileBirth(html,'Other'),null);
 assert.equal((await verifyMissingYahooPlayers(yahoo,espn,fetcher))[0].espnId,'2');
 assert.deepEqual(await verifyMissingYahooPlayers(yahoo,[{...espn[0],birthDate:'2001-04-20'}],fetcher),[]);
});
