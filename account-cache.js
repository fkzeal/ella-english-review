(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AccountCache=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PREFIX='ella-account-v1-';
  const isCache=key=>key===PREFIX+'last-backup'||/^(backup|base|conflict)-[a-z0-9-]+$/.test(key.slice(PREFIX.length))&&key.startsWith(PREFIX);
  function create(storage,indexedDB){
    let database;
    function open(){
      database ||= new Promise((resolve,reject)=>{
        const request=indexedDB.open('ella-account-cache',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('snapshots');
        request.onerror=()=>{database=null;reject(request.error);};
        request.onblocked=()=>{database=null;reject(new Error('请关闭旧页面后重试账号缓存迁移'));};
        request.onsuccess=()=>resolve(request.result);
      });
      return database;
    }
    async function transaction(mode,task){
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('snapshots',mode),store=tx.objectStore('snapshots');
        let result;
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(tx.error||new Error('账号缓存保存失败，旧备份已保留'));
        tx.onerror=()=>{};
        task(store,value=>{result=value;});
      });
    }
    async function get(key){
      if(!indexedDB){const text=storage.getItem(key);return text?JSON.parse(text):null;}
      return transaction('readonly',(store,set)=>{const request=store.get(key);request.onsuccess=()=>set(request.result??null);});
    }
    async function put(entries){
      if(!indexedDB){for(const [key,value] of entries)storage.setItem(key,JSON.stringify(value));return;}
      await transaction('readwrite',store=>{for(const [key,value] of entries)store.put(value,key);});
    }
    async function migrate(){
      if(!indexedDB)return;
      const entries=[];
      for(let i=0;i<storage.length;i++){
        const key=storage.key(i);
        if(isCache(key)){const raw=storage.getItem(key);entries.push({key,raw,value:JSON.parse(raw)});}
      }
      if(!entries.length)return;
      // Commit every legacy copy atomically before freeing localStorage space.
      // A failed/blocked/quota transaction leaves all original bytes in place.
      await transaction('readwrite',store=>{
        for(const {key,value} of entries){
          const request=store.get(key);
          request.onsuccess=()=>{
            if(request.result===undefined)store.put(value,key);
            else if(JSON.stringify(request.result)!==JSON.stringify(value)){
              // A second tab may already have advanced the migrated snapshot.
              // Retain the legacy copy separately instead of replacing it.
              store.put(value,'migration-'+key);
            }
          };
        }
      });
      for(const {key,raw} of entries)if(storage.getItem(key)===raw)storage.removeItem(key);
    }
    return {get,put,migrate};
  }
  return {create,isCache};
});
