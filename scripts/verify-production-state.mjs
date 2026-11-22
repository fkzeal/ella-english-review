export function verifyProductionState(localBank,remoteBank,localArchive,remoteArchive,runId){
  if(JSON.stringify(localBank)!==JSON.stringify(remoteBank))throw new Error('Production bank mismatch');
  const local=localArchive?.reports?.find(r=>r.runId===runId);
  const remote=remoteArchive?.reports?.find(r=>r.runId===runId);
  if(!local||!remote||JSON.stringify(local)!==JSON.stringify(remote))throw new Error('Production report missing or mismatched');
  return true;
}
export function maintenanceOutcome(mode,reportStatus){
  if(!['published','no-change','partial','failed'].includes(reportStatus))throw new Error('Maintenance report status required');
  const prefix=['schedule','schedule-maintenance-complete','schedule-maintenance-partial','schedule-maintenance-failed'].includes(mode)?'schedule':'manual';
  const suffix=reportStatus==='partial'?'partial':reportStatus==='failed'?'failed':'complete';
  return {mode:prefix+'-maintenance-'+suffix,overall:suffix==='complete'?'PASS':suffix==='partial'?'PARTIAL':'FAIL'};
}
