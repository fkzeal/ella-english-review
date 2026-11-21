const {test}=require('node:test'),assert=require('node:assert/strict');
test('lost idempotent publication response retries exact payload and complete JSON, with a finite failure bound',async()=>{
  const {fetchJson}=await import('../scripts/http-json.mjs'),original=global.fetch;
  let attempts=0,persisted=null;
  global.fetch=async(url,options)=>{
    attempts++;
    assert.equal(options.body,'same-payload');
    persisted??={count:5};
    if(attempts===1)throw new Error('response lost after commit');
    return new Response(JSON.stringify(persisted));
  };
  try{
    assert.deepEqual((await fetchJson('https://fixture/publish',{method:'POST',body:'same-payload'})).body,{count:5});
    assert.equal(attempts,2);
    attempts=0;global.fetch=async()=>{attempts++;throw new Error('unavailable');};
    await assert.rejects(()=>fetchJson('https://fixture/source'),/bounded retries/);
    assert.equal(attempts,3);
  }finally{global.fetch=original;}
});
