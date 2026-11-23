// Keep private API authentication, week validity and public scraper availability distinct.
export function classifyMatchupSources({officialVerified=false,officialHttpStatus=null,publicFresh=false,officialPending=false}={}){
  const code=Number(officialHttpStatus);
  const officialStatus=officialVerified?'VERIFIED':officialPending?'WEEK VERIFIED / CATEGORY TOTALS PENDING':code===401?'OWNER SIGN-IN REQUIRED':code===422?'CURRENT WEEK UNVERIFIED':code===404?'NOT ENABLED':code>=500?'SOURCE UNAVAILABLE':'NOT VERIFIED';
  return {
    officialStatus,
    publicStatus:publicFresh?'FRESH':'UNAVAILABLE / STALE',
    requiresOwner:!officialVerified&&code===401,
    weekUnverified:!officialVerified&&!officialPending&&code===422,
    scorePending:!officialVerified&&Boolean(officialPending),
    officialVerified:Boolean(officialVerified)
  };
}
