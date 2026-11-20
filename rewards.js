(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CatRewards=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const CAT_IDS=Array.from({length:100},(_,i)=>`cat-${String(i+1).padStart(3,'0')}`);
  const validId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(id)&&!(id in Object.prototype);
  const unitsFor=(correct,total)=>total>0&&correct===total?2:total>0&&correct*5>=total*4?1:0;
  function empty(){return {version:1,balance:0,settlements:[],openings:[]};}
  function validate(state){
    const r=state.rewards;
    if(r===undefined)return; // Older backups keep their learning history.
    const fail=()=>{throw new Error('猫咪奖励记录不正确，请恢复有效备份。');};
    if(!r||r.version!==1||!Number.isSafeInteger(r.balance)||r.balance<0||
      !Array.isArray(r.settlements)||r.settlements.length>100000||!Array.isArray(r.openings)||r.openings.length>100)fail();
    const sessions=new Set(),operations=new Set(),cats=new Set();
    let earned=0;
    for(const s of r.settlements){
      if(!s||!validId(s.id)||sessions.has(s.id)||!Number.isInteger(s.total)||s.total<1||s.total>20||
        !Number.isInteger(s.correct)||s.correct<0||s.correct>s.total||s.units!==unitsFor(s.correct,s.total)||
        typeof s.day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s.day))fail();
      sessions.add(s.id);earned+=s.units;
    }
    for(const o of r.openings){
      if(!o||!validId(o.id)||operations.has(o.id)||!CAT_IDS.includes(o.catId)||cats.has(o.catId)||
        (o.sessionId!==null&&!sessions.has(o.sessionId))||typeof o.at!=='string'||!Number.isFinite(Date.parse(o.at)))fail();
      operations.add(o.id);cats.add(o.catId);
    }
    if(r.balance!==earned-r.openings.length*6)fail();
    const t=state.session;
    if(t?.rewardId!==undefined&&!validId(t.rewardId))fail();
    const receipt=t?.rewardId&&r.settlements.find(s=>s.id===t.rewardId);
    if(receipt&&(t.index!==t.items.length||receipt.total!==t.items.length||
      receipt.correct!==t.results.filter(x=>x.correct).length||t.preview))fail();
  }
  function settle(state){
    const t=state.session;
    if(!t?.rewardId||t.preview||t.index!==t.items.length||t.results.length!==t.items.length)return null;
    const r=state.rewards ||= empty(),previous=r.settlements.find(s=>s.id===t.rewardId);
    if(previous)return previous;
    const correct=t.results.filter(x=>x.correct).length;
    const receipt={id:t.rewardId,total:t.items.length,correct,units:unitsFor(correct,t.items.length),day:t.day};
    r.settlements.push(receipt);r.balance+=receipt.units;
    return receipt;
  }
  function open(state,id,random=Math.random,at=new Date().toISOString()){
    if(!validId(id))throw new Error('宝箱操作编号无效。');
    const r=state.rewards ||= empty(),previous=r.openings.find(o=>o.id===id);
    if(previous)return previous;
    const remaining=CAT_IDS.filter(id=>!r.openings.some(o=>o.catId===id));
    if(!remaining.length)throw new Error('100 只猫咪已经全部收集啦！');
    if(r.balance<6)throw new Error('再攒一点星星，凑齐 3 颗就能打开宝箱。');
    const value=random();
    if(!Number.isFinite(value)||value<0||value>=1)throw new Error('宝箱暂未打开，请重试。');
    const sessionId=r.settlements.some(s=>s.id===state.session?.rewardId)?state.session.rewardId:null;
    const opening={id,catId:remaining[Math.floor(value*remaining.length)],sessionId,at};
    r.balance-=6;r.openings.push(opening);
    return opening;
  }
  return {CAT_IDS,empty,unitsFor,validate,settle,open};
});
