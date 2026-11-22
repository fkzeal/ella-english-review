const {test}=require('node:test'),assert=require('node:assert/strict');
test('completion requires actual matching run on both local and production archives',async()=>{
  const {verifyProductionState}=await import('../scripts/verify-production-state.mjs');
  const bank={revision:10},report={runId:'this-run',status:'no-change'},archive={reports:[report]};
  assert.equal(verifyProductionState(bank,bank,archive,archive,'this-run'),true);
  assert.throws(()=>verifyProductionState(bank,bank,{reports:[]},{reports:[]},'missing'),/missing/);
  assert.throws(()=>verifyProductionState(bank,bank,archive,{reports:[]},'this-run'),/missing/);
  assert.throws(()=>verifyProductionState(bank,bank,archive,{reports:[{...report,status:'partial'}]},'this-run'),/mismatched/);
  assert.throws(()=>verifyProductionState(bank,{revision:9},archive,archive,'this-run'),/bank mismatch/);
});
test('published partial or failed maintenance never receives a complete receipt',async()=>{
  const {maintenanceOutcome}=await import('../scripts/verify-production-state.mjs');
  assert.deepEqual(maintenanceOutcome('schedule','partial'),{mode:'schedule-maintenance-partial',overall:'PARTIAL'});
  assert.deepEqual(maintenanceOutcome('schedule','failed'),{mode:'schedule-maintenance-failed',overall:'FAIL'});
  assert.deepEqual(maintenanceOutcome('schedule','no-change'),{mode:'schedule-maintenance-complete',overall:'PASS'});
  assert.deepEqual(maintenanceOutcome('manual','published'),{mode:'manual-maintenance-complete',overall:'PASS'});
  assert.deepEqual(maintenanceOutcome('schedule-maintenance-partial','partial'),{mode:'schedule-maintenance-partial',overall:'PARTIAL'});
  assert.throws(()=>maintenanceOutcome('schedule','framework'),/status required/);
});
