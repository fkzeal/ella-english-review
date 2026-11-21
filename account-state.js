(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./engine'):root.ReviewEngine,
    typeof module==='object'&&module.exports?require('./rewards'):root.CatRewards);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.AccountState=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(E,R){
  'use strict';
  const copy=value=>value===undefined?undefined:JSON.parse(JSON.stringify(value));
  const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  function conflict(message){throw Object.assign(new Error(message+'；两份记录均已保留，请先导出备份再处理。'),{name:'AccountConflictError'});}
  function union(a=[],b=[],key=x=>x.id){
    const map=new Map();
    for(const value of [...a,...b]){
      const id=key(value);
      if(!id)throw new Error('云端记录缺少稳定编号');
      if(map.has(id)&&!equal(map.get(id),value))conflict('同一条记录的内容不一致');
      map.set(id,copy(value));
    }
    return [...map.values()];
  }
  function choose(base,local,remote,label){
    if(equal(local,remote)||equal(remote,base))return copy(local??null);
    if(equal(local,base))return copy(remote??null);
    conflict(label+'在两个设备上同时修改');
  }
  function mergeMap(base={},local={},remote={},label){
    const result=Object.create(null);
    for(const key of new Set([...Object.keys(local),...Object.keys(remote)])){
      const value=choose(base[key],local[key],remote[key],label);
      if(value!==null)result[key]=value;
    }
    return result;
  }
  function mergeSession(base,local,remote){
    if(equal(local,remote)||equal(remote,base))return copy(local);
    if(equal(local,base))return copy(remote);
    if(!local)return copy(remote);
    if(!remote)return copy(local);
    if(local.rewardId===remote.rewardId){
      const shorter=local.index<=remote.index?local:remote,longer=local.index>remote.index?local:remote;
      if(equal(shorter.items,longer.items)&&equal(shorter.results,longer.results.slice(0,shorter.index))){
        return {...copy(longer),hints:{...shorter.hints,...longer.hints},transcriptHints:{...shorter.transcriptHints,...longer.transcriptHints}};
      }
      conflict('同一组练习在两个设备上出现了不同答案');
    }
    // Independent sessions are stored separately; the current device keeps its place.
    return copy(local);
  }
  function mergeRewards(local=R.empty(),remote=R.empty()){
    const settlements=union(local.settlements,remote.settlements).sort((a,b)=>a.day.localeCompare(b.day)||a.id.localeCompare(b.id));
    // Keep cloud receipts canonical when two old installations own the same cat.
    const all=union(remote.openings,local.openings);
    const cats=new Set(),openings=all.filter(o=>{if(cats.has(o.catId))return false;cats.add(o.catId);return true;});
    const balance=settlements.reduce((n,s)=>n+s.units,0)-openings.length*6;
    if(balance<0)conflict('旧设备的宝箱支出重叠');
    return {version:1,balance,settlements,openings};
  }
  const when=h=>h.occurredAt||h.day+'T12:00:00.000Z';
  function merge(base,local,remote,today=E.day()){
    if(!remote)return copy(local);
    if(!local)return copy(remote);
    const newer=local.bank.revision>=remote.bank.revision?local.bank:remote.bank;
    const older=newer===local.bank?remote.bank:local.bank;
    const bank=E.mergeBank(older,newer);
    const a=local.state,b=remote.state,c=base?.state||E.emptyState();
    if(a.accountId&&b.accountId&&a.accountId!==b.accountId)throw new Error('不同账号的学习记录不能合并');
    const history=union(a.history,b.history,h=>h.syncId).sort((x,y)=>when(x).localeCompare(when(y))||x.syncId.localeCompare(y.syncId));
    const next=copy(a);
    next.accountId=a.accountId||b.accountId;
    next.history=history;
    next.settings=mergeMap(c.settings,a.settings,b.settings,'练习设置');
    next.moduleDates=mergeMap(c.moduleDates,a.moduleDates,b.moduleDates,'首次学习日期');
    next.defaultDates={...b.defaultDates,...a.defaultDates};
    next.localBatches=union(a.localBatches,b.localBatches);
    next.rewards=mergeRewards(a.rewards,b.rewards);
    next.session=mergeSession(c.session||null,a.session||null,b.session||null);
    const sessions=mergeMap(c.accountSessions,a.accountSessions,b.accountSessions,'保存的练习');
    for(const s of [a.session,b.session])if(s&&s.index<s.items.length&&s.rewardId!==next.session?.rewardId)sessions[s.rewardId]=copy(s);
    if(next.session)delete sessions[next.session.rewardId];
    // Completed sessions must not return as unfinished sessions on another device.
    for(const receipt of next.rewards.settlements)delete sessions[receipt.id];
    next.accountSessions=sessions;
    // Reconcile only schedules changed on both sides. Unchanged legacy schedules
    // are copied exactly; divergent units are replayed from their merged attempts.
    const replay=E.emptyState();
    Object.assign(replay,{moduleDates:copy(next.moduleDates),defaultDates:copy(next.defaultDates),localBatches:copy(next.localBatches)});
    E.syncBatches(bank,replay,today);
    for(const h of history)E.grade(bank,replay,h.questionId,h.selected,h.help,h.day);
    next.units={};
    for(const key of new Set([...Object.keys(a.units||{}),...Object.keys(b.units||{})])){
      const x=a.units?.[key],y=b.units?.[key],z=c.units?.[key];
      next.units[key]=copy(equal(x,y)||equal(y,z)?x:equal(x,z)?y:replay.units[key]);
    }
    next.points={};
    for(const key of new Set([...Object.keys(a.points),...Object.keys(b.points)])){
      const x=a.points[key],y=b.points[key],z=c.points[key];
      next.points[key]=copy(equal(x,y)||equal(y,z)?x:equal(x,z)?y:replay.points[key]);
    }
    E.syncBatches(bank,next,today);validate({bank,state:next});
    return {bank,state:next,baseline:JSON.stringify(newer)};
  }
  function validate(bundle){
    E.validateBank(bundle.bank);E.validateState(bundle.state,bundle.bank);
    const ids=new Set();
    for(const h of bundle.state.history){
      if(typeof h.syncId!=='string'||!/^[a-zA-Z0-9_-]{1,150}$/.test(h.syncId)||ids.has(h.syncId))throw new Error('作答同步编号无效或重复');
      ids.add(h.syncId);
    }
    const sessions=bundle.state.accountSessions||{};
    if(typeof sessions!=='object'||Array.isArray(sessions)||Object.keys(sessions).length>100)throw new Error('保存的练习过多或格式无效');
    for(const [id,session] of Object.entries(sessions)){
      if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id)||id in Object.prototype||id!==session.rewardId)throw new Error('练习编号不一致');
      E.validateState({...bundle.state,session},bundle.bank);
    }
    return bundle;
  }
  async function normalize(bundle,{accountId,deviceId,crypto,migrate=false}){
    const result=copy(bundle),s=result.state,wasBound=Boolean(s.accountId);
    if(s.accountId&&s.accountId!==accountId)throw new Error('请先切换账号，不能迁移其他账号的记录');
    s.accountId=accountId;s.accountSessions ||= {};
    const counts=new Map();
    for(const h of s.history){
      if(!h.syncId){
        const core=JSON.stringify([h.eventId||null,h.originDeviceId||h.deviceId||null,h.questionId,h.day,h.selected,h.help]);
        const occurrence=counts.get(core)||0;counts.set(core,occurrence+1);
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(core+'|'+occurrence));
        h.syncId='legacy-'+[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
      }
      if((migrate&&!wasBound)||!h.accountId){h.recordSource='imported';h.imported=true;}
      h.accountId=accountId;
    }
    // Session results refer to the same attempts but JSON persistence breaks references.
    for(const t of [s.session,...Object.values(s.accountSessions)].filter(Boolean)){
      t.rewardId ||= 'session-'+crypto.randomUUID();
      t.results=t.results.map(r=>s.history.find(h=>h.eventId&&h.eventId===r.eventId)||s.history.findLast(h=>h.questionId===r.questionId&&h.day===r.day&&h.selected===r.selected&&h.help===r.help)||r);
    }
    validate(result);return result;
  }
  return {copy,merge,validate,normalize,mergeRewards};
});
