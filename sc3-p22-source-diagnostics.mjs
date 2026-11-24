// Only bounded allowlisted categories; never expose raw connection, fetch or PDF errors.
export function safeP22SourceFailure(e){
 const message=String(e?.message??'');
   const codes=['NBA report index unavailable','Fresh official report unavailable','NBA PDF unavailable','Invalid NBA PDF','Invalid NBA report provenance','NBA report title mismatch','NBA report table header missing','NBA report page sequence mismatch','NBA game date format changed','Invalid NBA game date','NBA matchup format changed','Unknown NBA matchup','Unknown report team','Unverified non-submission','NBA report row format changed','Unknown NBA player name format','Duplicate NBA report identity','NBA report coverage unavailable','Unexpected PDF geometry','Invalid PDF coordinates','Invalid NBA report page count','NBA source response unavailable','NBA source size limit exceeded','NBA report page text limit exceeded'];
   return codes.includes(message)?message:/Cannot find (?:module|package)|ERR_MODULE_NOT_FOUND/.test(message)?'pdf_dependency_unavailable':/DOMMatrix|ImageData|Path2D/.test(message)?'pdf_runtime_geometry_unavailable':/timeout|timed out|aborted/i.test(message)?'source_or_database_timeout':/fetch failed|network/i.test(message)?'source_network':/permission denied/i.test(message)?'database_permission':/column .* does not exist/i.test(message)?'database_schema':/pdf/i.test(message)?'pdf_runtime_error':/Scoped role/.test(message)?'scoped_role_error':/is not a function|Cannot read properties|undefined/.test(message)?'data_shape_or_runtime':'unknown_source_failure';
}
export async function readP22Evidence(read){
 try{return {data:await read(),failure:null};}
 catch(error){return {data:null,failure:safeP22SourceFailure(error)};}
}
