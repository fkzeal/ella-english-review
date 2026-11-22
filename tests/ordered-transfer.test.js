const {test}=require('node:test'),assert=require('node:assert/strict');
test('chunk transfer bounds concurrency, restores manifest order and drains active work on failure',async()=>{
  const {orderedTransfer}=await import('../scripts/ordered-transfer.mjs');
  let active=0,peak=0;
  const result=await orderedTransfer([0,1,2,3,4,5],async n=>{
    active++;peak=Math.max(peak,active);
    await new Promise(r=>setTimeout(r,12-n));active--;return 'chunk-'+n;
  });
  assert.equal(peak,4);assert.deepEqual(result,[0,1,2,3,4,5].map(n=>'chunk-'+n));
  let done=0;
  await assert.rejects(()=>orderedTransfer([0,1,2,3,4,5],async n=>{
    await new Promise(r=>setTimeout(r,n+1));done++;
    if(n===0)throw new Error('transfer failed');
  }),/transfer failed/);
  assert.equal(done,4,'already-started requests settle; no partial archive is returned');
});
