export function verifyProductionState(localBank,remoteBank,localArchive,remoteArchive,runId){
  if(JSON.stringify(localBank)!==JSON.stringify(remoteBank))throw new Error('Production bank mismatch');
  const local=localArchive?.reports?.find(r=>r.runId===runId);
  const remote=remoteArchive?.reports?.find(r=>r.runId===runId);
  if(!local||!remote||JSON.stringify(local)!==JSON.stringify(remote))throw new Error('Production report missing or mismatched');
  return true;
}
