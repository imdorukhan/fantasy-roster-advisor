// Keep private API authentication, week validity and public scraper availability distinct.
export function classifyMatchupSources({officialVerified=false,officialHttpStatus=null,publicFresh=false}={}){
  const code=Number(officialHttpStatus);
  const officialStatus=officialVerified?'VERIFIED':code===401?'OWNER SIGN-IN REQUIRED':code===422?'CURRENT WEEK UNVERIFIED':code===404?'NOT ENABLED':code>=500?'SOURCE UNAVAILABLE':'NOT VERIFIED';
  return {
    officialStatus,
    publicStatus:publicFresh?'FRESH':'UNAVAILABLE / STALE',
    requiresOwner:!officialVerified&&code===401,
    weekUnverified:!officialVerified&&code===422,
    officialVerified:Boolean(officialVerified)
  };
}
