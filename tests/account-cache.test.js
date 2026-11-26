const {test}=require('node:test'),assert=require('node:assert/strict');
const {IDBFactory}=require('fake-indexeddb'),Cache=require('../account-cache');
function storage(){
  const records=new Map();
  return {get length(){return records.size;},key:i=>[...records.keys()][i],getItem:k=>records.get(k)??null,
    setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k),records};
}
test('legacy multi-account snapshots migrate before deletion; auth and pending reward operations stay untouched',async()=>{
  const local=storage(),cache=Cache.create(local,new IDBFactory());
  for(const id of ['ella','dad','mom','test-1','test-2','test-3']){
    local.setItem('ella-account-v1-backup-'+id,JSON.stringify({state:{accountId:id,history:[id],session:{index:1}}}));
    local.setItem('ella-account-v1-base-'+id,JSON.stringify({revision:8,bundle:{state:{accountId:id}}}));
  }
  local.setItem('ella-account-v1-last-backup',JSON.stringify({state:{accountId:'ella'}}));
  local.setItem('ella-account-v1','binding');
  local.setItem('ella-account-v1-open-ella','pending');
  local.setItem('lesson-loop-data-v1','current');
  await cache.migrate();
  assert.equal(local.length,3);
  for(const id of ['ella','dad','mom','test-1','test-2','test-3']){
    assert.equal((await cache.get('ella-account-v1-backup-'+id)).state.accountId,id);
    assert.equal((await cache.get('ella-account-v1-base-'+id)).revision,8);
  }
  assert.equal(local.getItem('ella-account-v1-open-ella'),'pending');
  assert.equal(local.getItem('lesson-loop-data-v1'),'current');
});
test('failed IndexedDB migration never deletes original backups',async()=>{
  const local=storage();local.setItem('ella-account-v1-backup-ella','{"original":true}');
  const broken={open(){const req={};queueMicrotask(()=>{req.error=new Error('disk full');req.onerror();});return req;}};
  await assert.rejects(Cache.create(local,broken).migrate(),/disk full/);
  assert.equal(local.getItem('ella-account-v1-backup-ella'),'{"original":true}');
});
test('a legacy retry cannot overwrite a newer migrated snapshot',async()=>{
  const local=storage(),cache=Cache.create(local,new IDBFactory()),key='ella-account-v1-backup-ella';
  await cache.put([[key,{history:['new','offline']} ]]);
  local.setItem(key,JSON.stringify({history:['old']}));
  await cache.migrate();
  assert.deepEqual((await cache.get(key)).history,['new','offline']);
  assert.equal(local.getItem(key),null);
});
test('large repeated snapshots use IndexedDB without consuming localStorage capacity',async()=>{
  const local=storage(),db=new IDBFactory(),cache=Cache.create(local,db);
  for(let n=0;n<20;n++)for(const id of ['ella','dad','mom','test-1','test-2','test-3']){
    const bundle={state:{accountId:id,history:[n],session:{index:n%10}},bank:'x'.repeat(450000)};
    await cache.put([['ella-account-v1-backup-'+id,bundle],['ella-account-v1-base-'+id,{revision:n,bundle}]]);
  }
  assert.equal(local.length,0);
  const reopened=Cache.create(local,db);
  assert.deepEqual((await reopened.get('ella-account-v1-backup-ella')).state.history,[19]);
  assert.equal((await reopened.get('ella-account-v1-base-dad')).revision,19);
});
