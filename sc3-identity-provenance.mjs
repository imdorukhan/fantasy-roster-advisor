// Distinguish a persisted SC3 identity from a current, verified public-profile
// fallback. Neither a candidate name match nor a transient lookup writes the DB.
const validId=value=>/^\d{1,12}$/.test(String(value??''));
export function resolveVerifiedIdentity(yahooId,persistedEspnId,publicMatches=[]){
 if(!validId(yahooId))return {espnId:null,source:'UNRESOLVED',persisted:false,readOnly:true};
 const id=String(yahooId);
 if(validId(persistedEspnId))return {
  espnId:String(persistedEspnId),source:'SC3_VERIFIED_LINK',persisted:true,readOnly:true
 };
 const matches=Array.isArray(publicMatches)?publicMatches:[];
 const certified=matches.filter(match=>String(match?.yahooId)===id&&match.status==='verified'&&
  validId(match.espnId)&&/exact birth date|exact jersey/i.test(match.evidence||''));
 if(matches.length!==1||certified.length!==1)return {
  espnId:null,source:'UNRESOLVED',persisted:false,readOnly:true
 };
 const {espnId,evidence}=certified[0];
 return {
  espnId:String(espnId),source:'YAHOO_PUBLIC_PROFILE_AND_ESPN_CATALOG',
  persisted:false,readOnly:true,evidence,
  yahooProfileUrl:'https://sports.yahoo.com/nba/players/'+id+'/',
  espnProfileUrl:'https://www.espn.com/nba/player/_/id/'+String(espnId)+'/'
 };
}
