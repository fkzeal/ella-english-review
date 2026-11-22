const {test}=require('node:test'),assert=require('node:assert/strict');
const {webcrypto:crypto}=require('node:crypto');
const Sync=require('../account-sync');

test('account login waits 30 seconds and reports a Chinese timeout without binding or replacing local progress',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const records=new Map(),bundle={state:{history:[{id:'local-progress'}]}};
  let signal,applied=false;
  const client=Sync.create({
    storage:{getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value)},
    crypto,enabled:true,getBundle:()=>bundle,applyBundle:async()=>{applied=true;},
    fetch:async(url,options)=>{
      signal=options.signal;
      return new Promise((resolve,reject)=>{
        signal.addEventListener('abort',()=>reject(Object.assign(new Error('Fetch is aborted'),{name:'AbortError'})),{once:true});
      });
    }
  });
  const pending=client.login('ella','fixture-password');
  const rejected=assert.rejects(pending,{name:'AbortError',message:'连接超时，请稍后重试'});
  t.mock.timers.tick(7000);
  assert.equal(signal.aborted,false);
  t.mock.timers.tick(22999);
  assert.equal(signal.aborted,false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(client.view().error,'连接超时，请稍后重试');
  assert.equal(client.view().busy,false);
  assert.equal(client.view().account,null);
  assert.equal(applied,false);
  assert.deepEqual(bundle.state.history,[{id:'local-progress'}]);
});
