(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReviewStorage=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEY='lesson-loop-data-v1';
  class ConflictError extends Error {
    constructor(){super('另一个页面已更新记录，已重新读取。请再操作一次。');this.name='ConflictError';}
  }
  function transactionLock(indexedDB){
    let database;
    function open(){
      database ||= new Promise((resolve,reject)=>{
        const request=indexedDB.open('lesson-loop-write-lock',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('mutex');
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(new Error('请关闭旧版页面后重试保存。'));
        request.onsuccess=()=>resolve(request.result);
      });
      return database;
    }
    return {async request(key,task){
      const db=await open();
      return new Promise((resolve,reject)=>{
        // Read/write transactions on the same store are serialized across tabs.
        // task must be synchronous: the localStorage CAS runs inside onsuccess.
        const tx=db.transaction('mutex','readwrite');
        let result,error;
        tx.oncomplete=()=>error?reject(error):resolve(result);
        tx.onabort=()=>reject(error||tx.error||new Error('保存事务未完成，请重试。'));
        const request=tx.objectStore('mutex').get(key);
        request.onsuccess=()=>{
          try{result=task();}catch(err){error=err;tx.abort();}
        };
      });
    }};
  }
  function create(storage,engine,locks,indexedDB){
    const mutex=locks?.request?locks:indexedDB?transactionLock(indexedDB):null;
    let raw=null,blocked=false,recovery=null;
    function validate(value){
      const saved=JSON.parse(value);
      engine.validateBank(saved.bank);engine.validateState(saved.state,saved.bank);
      if(saved.revision!==undefined&&(!Number.isSafeInteger(saved.revision)||saved.revision<0))throw new Error('记录版本无效');
      return saved;
    }
    function read(){
      raw=storage.getItem(KEY);
      if(raw===null){blocked=false;return null;}
      try{const saved=validate(raw);blocked=false;return saved;}
      catch(error){
        blocked=true;recovery=raw;
        // Keep the original in place even if quota prevents the extra copy.
        try{storage.setItem(KEY+'-recovery',raw);}catch{}
        throw error;
      }
    }
    async function write(value,{restore=false}={}){
      engine.validateBank(value.bank);engine.validateState(value.state,value.bank);
      if(blocked&&!restore)throw new Error('原始记录读取失败，已保护原文件。请导出原始记录或恢复有效备份。');
      if(!mutex)throw new Error('当前浏览器不支持安全的多页面保存，请使用新版浏览器。');
      const expected=raw;
      return mutex.request(KEY,()=>{
        const latest=storage.getItem(KEY);
        if(latest!==expected)throw new ConflictError();
        if(restore&&latest!==null)storage.setItem(KEY+'-before-restore',latest);
        if(!restore&&latest!==null){
          const previous=validate(latest);
          if(previous.bank.revision!==value.bank.revision||previous.baseline!==value.baseline)storage.setItem(KEY+'-before-update',latest);
        }
        const revision=latest===null?0:(()=>{try{return validate(latest).revision||0;}catch{return 0;}})();
        const next=JSON.stringify({...value,revision:revision+1});
        storage.setItem(KEY,next);
        raw=next;blocked=false;
        return revision+1;
      });
    }
    return {read,write,changed:()=>{try{return storage.getItem(KEY)!==raw;}catch{return false;}},
      recovery:()=>recovery||storage.getItem(KEY+'-recovery'),get blocked(){return blocked;}};
  }
  return {KEY,ConflictError,create};
});
