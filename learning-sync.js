(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.LearningSync=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const KEY='ella-device-v1';
  const identity=q=>JSON.stringify([q.id,q.pointId,q.reviewUnit||null,q.learningTarget||null,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer,q.active!==false]);
  async function hash(value,crypto){
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  function create({storage,crypto,fetch,enabled,locks,onChange=()=>{}}){
    let busy=false,lastError='',status=null;
    const lock=task=>locks?.request?locks.request(KEY,task):Promise.resolve().then(task);
    function read(){const raw=storage.getItem(KEY);return raw?JSON.parse(raw):null;}
    function save(value){storage.setItem(KEY,JSON.stringify(value));}
    function initialize(){
      if(!enabled)return null;
      let value=read();
      if(!value){
        value={deviceId:crypto.randomUUID(),enrollment:[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join(''),token:null,syncedAt:null};
        save(value);
      }
      if(!/^[0-9a-f-]{36}$/.test(value.deviceId||'')||!/^[0-9a-f]{64}$/.test(value.enrollment||''))throw new Error('设备身份损坏；本地学习记录仍保留');
      return value;
    }
    async function request(path,data,value){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
      try{
        const response=await fetch('/api/'+path,{method:data?'POST':'GET',cache:'no-store',signal:controller.signal,
          headers:{'Content-Type':'application/json',...(value?.token?{'Authorization':'Bearer '+value.token,'X-Device-Id':value.deviceId}:{})},
          ...(data?{body:JSON.stringify(data)}:{})});
        const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||'服务器连接未成功'),{status:response.status});return result;
      }finally{clearTimeout(timer);}
    }
    async function prepare(result,q,revision){
      if(!enabled)return;
      const value=await lock(initialize);
      Object.assign(result,{eventId:crypto.randomUUID(),deviceId:value.deviceId,occurredAt:new Date().toISOString(),fingerprint:await hash(identity(q),crypto),bankRevision:revision,recordSource:'live'});
    }
    async function sync(history){
      if(!enabled||busy)return;busy=true;
      try{
        let value=await lock(initialize);
        if(!value.token){
          const registered=await request('register',{deviceId:value.deviceId,enrollment:value.enrollment});
          value=await lock(()=>{const latest=read();if(latest.deviceId!==value.deviceId)throw new Error('设备身份已变化，请刷新');latest.token=registered.token;save(latest);return latest;});
        }
        // History itself is the durable outbox: a local save succeeds before upload.
        const markKey=KEY+'-receipts';
        for(let batch=0;batch<10;batch++){
          const receipts=JSON.parse(storage.getItem(markKey)||'{}');
          const pending=history.filter(h=>h.deviceId===value.deviceId&&h.eventId&&h.fingerprint&&!receipts[h.eventId]).slice(0,100);
          if(!pending.length)break;
          const result=await request('events',{events:pending.map(h=>({eventId:h.eventId,questionId:h.questionId,fingerprint:h.fingerprint,
            occurredAt:h.occurredAt,day:h.day,selected:h.selected,help:h.help,source:h.recordSource||'imported',originDeviceId:h.originDeviceId||null}))},value);
          const sent=new Set(pending.map(h=>h.eventId));
          await lock(()=>{
            const merged=JSON.parse(storage.getItem(markKey)||'{}');
            for(const id of result.acknowledged||[])if(sent.has(id))merged[id]=true;
            storage.setItem(markKey,JSON.stringify(merged));
            const latest=read();latest.syncedAt=result.syncedAt;save(latest);
          });
        }
        status=await request('device',null,value);lastError='';
      }catch(error){
        lastError=error.message==='Failed to fetch'?'离线或服务器未连接，记录已保存在本机':error.message;
        if(error.status===401)await lock(()=>{const value=read();if(value){value.token=null;save(value);}});
      }finally{busy=false;onChange();}
    }
    async function backfill(history,bank){
      if(!enabled)throw new Error('请在正式网址回补记录');
      const value=await lock(initialize);
      for(const [i,h] of history.entries()){
        if(h.eventId)continue;
        const q=bank.questions.find(q=>q.id===h.questionId);if(!q)continue;
        const fingerprint=await hash(identity(q),crypto);
        Object.assign(h,{eventId:'backfill-'+await hash(JSON.stringify([value.deviceId,i,h.questionId,h.day,h.selected,h.help,Boolean(h.imported),h.originDeviceId||null,fingerprint]),crypto),
          deviceId:value.deviceId,originDeviceId:h.originDeviceId||null,occurredAt:h.day+'T12:00:00+08:00',
          fingerprint,bankRevision:bank.revision,recordSource:h.imported?'imported':'backfill'});
      }
    }
    function view(history=[]){
      let value;try{value=read();}catch{}
      const receipts=(()=>{try{return JSON.parse(storage.getItem(KEY+'-receipts')||'{}');}catch{return {};}})();
      return {enabled,busy,deviceId:value?.deviceId||null,syncedAt:value?.syncedAt||null,error:lastError,status,
        pending:history.filter(h=>h.deviceId===value?.deviceId&&h.eventId&&!receipts[h.eventId]).length};
    }
    return {prepare,sync,backfill,view,initialize:()=>lock(initialize)};
  }
  return {KEY,identity,hash,create};
});
