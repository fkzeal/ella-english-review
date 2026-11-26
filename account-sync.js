(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./account-state'):root.AccountState,
    typeof module==='object'&&module.exports?require('./account-cache'):root.AccountCache);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AccountSync=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(S,C){
  'use strict';
  const KEY='ella-account-v1',DEVICE='ella-account-installation-v1';
  const ACCOUNTS=[['ella','Ella'],['dad','爸爸'],['mom','妈妈'],['test-1','测试一'],['test-2','测试二'],['test-3','测试三']];
  function create({storage,crypto,fetch,enabled,getBundle,applyBundle,onChange=()=>{},indexedDB=globalThis.indexedDB}){
    let busy=false,error='',syncedAt=null,dirty=false;
    const snapshots=C.create(storage,indexedDB);
    const read=key=>{const text=storage.getItem(key);return text?JSON.parse(text):null;};
    const write=(key,value)=>storage.setItem(key,JSON.stringify(value));
    function installation(){
      let id=read(DEVICE);
      if(!id){id=crypto.randomUUID();write(DEVICE,id);}
      if(typeof id!=='string'||!/^[0-9a-f-]{36}$/.test(id))throw new Error('设备身份异常，请先导出备份');
      return id;
    }
    const auth=()=>read(KEY);
    function view(){
      let account;try{account=auth();}catch{error='账号绑定记录异常，请重新登录';}
      return {enabled,busy,error,dirty,account:account?{id:account.id,name:account.name}:null,syncedAt};
    }
    async function request(route,data,binding=auth()){
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
      try{
        const response=await fetch('/api/accounts/'+route,{method:data?'POST':'GET',cache:'no-store',signal:controller.signal,
          headers:{'Content-Type':'application/json',...(binding?{Authorization:'Bearer '+binding.token,'X-Device-Id':installation()}:{})},
          ...(data?{body:JSON.stringify(data)}:{})});
        const result=await response.json();
        if(!response.ok)throw Object.assign(new Error(result.error||'云端暂时无法连接'),{status:response.status});
        return result;
      }catch(e){
        if(controller.signal.aborted||e.name==='AbortError'){
          throw Object.assign(new Error('连接超时，请稍后重试'),{name:'AbortError'});
        }
        throw e;
      }finally{clearTimeout(timeout);}
    }
    async function cache(bundle){
      const id=bundle.state.accountId||'unbound';
      await snapshots.put([[KEY+'-backup-'+id,bundle],[KEY+'-last-backup',bundle]]);
    }
    async function accept(response,binding){
      await applyBundle(response.bundle);
      await snapshots.put([[KEY+'-base-'+binding.id,response]]);
      syncedAt=response.updatedAt;error='';dirty=false;
    }
    async function sourceFor(id,current,importLocal){
      if(current.state.accountId===id)return current;
      const cached=await snapshots.get(KEY+'-backup-'+id);
      if(cached)return cached;
      if(!current.state.accountId&&importLocal)return current;
      return null;
    }
    async function login(id,code,{importLocal=true,initialize=false}={}){
      if(!enabled)throw new Error('请在正式网址绑定云端账号');
      if(busy)throw new Error('正在同步，请稍后再试');
      busy=true;error='';onChange();
      try{
        await snapshots.migrate();
        const current=S.copy(getBundle());await cache(current);
        const response=await request('login',{accountId:id,code,deviceId:installation(),initialize},null);
        const binding={id,name:response.account.name,token:response.token,expiresAt:response.expiresAt};
        const source=await sourceFor(id,current,importLocal);
        let bundle=source?await S.normalize(source,{accountId:id,deviceId:installation(),crypto,migrate:true}):response.bundle;
        if(!bundle){
          const empty=S.copy(current);
          // A new account starts with shared content, never the previous
          // learner's private variants or progress.
          empty.bank.questions=empty.bank.questions.filter(q=>!q.practiceFor);
          delete empty.bank.practiceAccountId;
          const ids=new Set(empty.bank.questions.map(q=>q.id));
          for(const lesson of empty.bank.lessons)for(const target of lesson.learningTargets||[])target.questionIds=target.questionIds.filter(q=>ids.has(q));
          empty.baseline=JSON.stringify(empty.bank);
          empty.state={version:1,learned:{},points:{},history:[],session:null,settings:{size:10},accountId:id,accountSessions:{}};
          bundle=await S.normalize(empty,{accountId:id,deviceId:installation(),crypto});
        }
        // Existing cloud preferences win the initial merge; local histories/cats survive.
        let base=null;
        if(response.bundle&&source){base=S.copy(bundle);base.state.units={};base.state.points={};base.state.session=null;}
        bundle=S.merge(base,bundle,response.bundle);
        const saved=await request('state',{operationId:crypto.randomUUID(),revision:response.revision,bundle,migrate:true},binding);
        // Store ownership with the local state before activating credentials.
        await accept(saved,binding);write(KEY,binding);
        return saved;
      }catch(e){error=e.message;throw e;}
      finally{busy=false;onChange();}
    }
    async function sync({preferCloud=false}={}){
      const binding=auth();
      if(!enabled||!binding||busy)return false;
      busy=true;error='';onChange();
      try{
        await snapshots.migrate();
        if(getBundle().state.accountId!==binding.id)throw new Error('本机记录所属账号与登录账号不同，请重新绑定');
        // Recover an acknowledged-but-unseen chest before sending any snapshot.
        const pending=read(KEY+'-open-'+binding.id);
        if(pending){
          try{
            const response=await request('open',pending,binding);
            const local=await S.normalize(getBundle(),{accountId:binding.id,deviceId:installation(),crypto});
            const merged=S.merge((await snapshots.get(KEY+'-base-'+binding.id))?.bundle,local,response.bundle);
            await applyBundle(merged);await snapshots.put([[KEY+'-base-'+binding.id,response]]);
            write(KEY+'-open-'+binding.id,null);
          }catch(e){if(e.status===409)write(KEY+'-open-'+binding.id,null);else throw e;}
        }
        for(let attempt=0;attempt<3;attempt++){
          const remote=await request('state',null,binding);
          const local=await S.normalize(getBundle(),{accountId:binding.id,deviceId:installation(),crypto});
          let base=(await snapshots.get(KEY+'-base-'+binding.id))?.bundle;
          if(preferCloud&&remote.bundle){
            // Explicit recovery keeps immutable attempts and cats; only conflicting
            // scheduling preferences and the shared cursor use the cloud version.
            await cache(local);
            await snapshots.put([[KEY+'-conflict-'+binding.id,{local,remote}]]);
            base=S.copy(local);
            const pendingSession=local.state.session;
            for(const key of ['settings','moduleDates','session'])local.state[key]=S.copy(remote.bundle.state[key]);
            local.state.accountSessions={...local.state.accountSessions,...remote.bundle.state.accountSessions};
            if(pendingSession&&pendingSession.index<pendingSession.items.length&&pendingSession.rewardId!==local.state.session?.rewardId){
              local.state.accountSessions[pendingSession.rewardId]=pendingSession;
            }
            const canonical=new Map((remote.bundle.state.rewards?.settlements||[]).map(s=>[s.id,s]));
            if(local.state.rewards)local.state.rewards.settlements=local.state.rewards.settlements.map(s=>canonical.get(s.id)||s);
          }
          const merged=S.merge(base,local,remote.bundle);
          if(JSON.stringify(merged)===JSON.stringify(remote.bundle)){
            await accept(remote,binding);return true;
          }
          try{
            const saved=await request('state',{operationId:crypto.randomUUID(),revision:remote.revision,bundle:merged},binding);
            await accept(saved,binding);return true;
          }catch(e){if(e.status===409&&attempt<2)continue;throw e;}
        }
      }catch(e){error=e.name==='AbortError'?'连接超时，记录已保存在本机，将自动重试':e.message;return false;}
      finally{busy=false;onChange();}
    }
    async function prepare(result,q){
      const binding=auth();
      if(!enabled||!binding)return;
      if(getBundle().state.accountId!==binding.id)throw new Error('请先完成账号绑定');
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([q.id,q.pointId,q.reviewUnit||null,q.learningTarget||null,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer,q.active!==false])));
      const eventId=crypto.randomUUID();
      Object.assign(result,{eventId,syncId:'event-'+eventId,accountId:binding.id,deviceId:installation(),
        occurredAt:new Date().toISOString(),recordSource:'live',
        fingerprint:[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')});
    }
    async function open(){
      const binding=auth();
      if(!binding)throw new Error('请先绑定账号');
      if(!await sync())throw new Error(error||'请联网同步后再开宝箱；星星已经保存在本机');
      busy=true;onChange();
      try{
        const base=await snapshots.get(KEY+'-base-'+binding.id);
        const pending={operationId:crypto.randomUUID(),revision:base.revision};
        write(KEY+'-open-'+binding.id,pending);
        const response=await request('open',pending,binding);
        await accept(response,binding);write(KEY+'-open-'+binding.id,null);
        return response.result;
      }catch(e){error=e.message;throw e;}
      finally{busy=false;onChange();}
    }
    async function logout(){
      if(!await sync())throw new Error('请先同步成功再退出，避免留下未上传记录');
      await cache(getBundle());await request('logout',{});write(KEY,null);onChange();
    }
    async function backup(){
      const response=await request('state');
      if(!response.bundle)throw new Error('云端还没有备份');
      return {kind:'lesson-loop-backup',version:1,exportedAt:new Date().toISOString(),...response.bundle};
    }
    async function localBackup(){
      await snapshots.migrate();
      const bundle=await snapshots.get(KEY+'-last-backup');
      if(!bundle)throw new Error('还没有迁移前备份；可以导出当前完整备份。');
      return {kind:'lesson-loop-backup',version:1,exportedAt:new Date().toISOString(),...bundle};
    }
    async function resolve(){
      if(!await sync({preferCloud:true}))throw new Error(error||'尚未同步，请保留备份后重试');
    }
    async function importBundle(bundle){
      const binding=auth();
      if(!binding)throw new Error('请先绑定账号');
      if(bundle.state.accountId&&bundle.state.accountId!==binding.id)throw new Error('这份备份属于另一个账号，请切换到对应账号恢复');
      if(!await sync())throw new Error(error||'请先联网同步再恢复备份');
      busy=true;onChange();
      try{
        await cache(getBundle());
        const source=await S.normalize(bundle,{accountId:binding.id,deviceId:installation(),crypto,migrate:true});
        const remote=await request('state');
        const known=new Map((remote.bundle?.state.history||[]).map(h=>[h.syncId,h]));
        source.state.history=source.state.history.map(h=>{
          if(known.has(h.syncId))return S.copy(known.get(h.syncId));
          return {...h,recordSource:'imported',imported:true};
        });
        for(const session of [source.state.session,...Object.values(source.state.accountSessions||{})].filter(Boolean)){
          session.results=session.results.map(r=>source.state.history.find(h=>h.syncId===r.syncId)||r);
        }
        // Restoring a backup adds history and rewards; current cloud settings win.
        const base=S.copy(source);base.state.units={};base.state.points={};base.state.session=null;
        const merged=S.merge(base,source,remote.bundle);
        const response=await request('state',{operationId:crypto.randomUUID(),revision:remote.revision,bundle:merged,migrate:true});
        await accept(response,binding);
      }finally{busy=false;onChange();}
    }
    return {view,login,sync,prepare,open,logout,installation,backup,localBackup,resolve,importBundle,migrateCache:()=>snapshots.migrate(),
      accountStatus:()=>request('status',null,null),markDirty:()=>{dirty=true;}};
  }
  return {KEY,ACCOUNTS,create};
});
