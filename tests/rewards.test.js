const test=require('node:test'),assert=require('node:assert/strict');
const R=require('../rewards'),E=require('../engine'),S=require('../storage'),bank=require('../question-bank.json');
function session(state,id,correct,total=10){
  const qs=bank.questions.slice(0,total);
  state.session={rewardId:id,items:qs.map(q=>q.id),index:total,day:E.day(),
    results:qs.map((q,i)=>({questionId:q.id,pointId:q.pointId,correct:i<correct,help:false,selected:i<correct?q.answer:(q.answer+1)%q.options.length}))};
}
test('whole and half stars use exact ratios, without rounded percentages',()=>{
  for(const [correct,total,units] of [[10,10,2],[8,10,1],[12,15,1],[16,20,1],[5,6,1],[7,10,0],[11,15,0],[15,19,0],[0,0,0],[0,6,0]])
    assert.equal(R.unitsFor(correct,total),units,`${correct}/${total}`);
});
test('a completed group awards once and survives serialization and a repeated settlement',()=>{
  let state=E.emptyState();session(state,'group-1',8);
  assert.equal(R.settle(state).units,1);R.settle(state);assert.equal(state.rewards.balance,1);
  state=JSON.parse(JSON.stringify(state));R.settle(state);E.validateState(state,bank);
  assert.equal(state.rewards.settlements.length,1);assert.equal(state.rewards.balance,1);
});
test('unfinished groups, old summaries and date preview practice never mint stars',()=>{
  const state=E.emptyState();session(state,'g',10);state.session.index=9;state.session.results.pop();
  assert.equal(R.settle(state),null);assert.equal(state.rewards,undefined);
  session(state,'g',10);state.session.preview=true;assert.equal(R.settle(state),null);
  session(state,'g',10);delete state.session.rewardId;assert.equal(R.settle(state),null);
});
test('assisted correct answers earn encouragement without changing mastery flags',()=>{
  const state=E.emptyState();session(state,'assisted',10);state.session.results[0].help=true;
  R.settle(state);assert.equal(state.rewards.balance,2);assert.equal(state.session.results[0].help,true);
});
test('chests spend exactly three stars, keep overflow, and draw all 100 cats without duplicates',()=>{
  const state=E.emptyState();
  for(let i=0;i<301;i++){session(state,`g-${i}`,10);R.settle(state);}
  const initial=state.rewards.balance;
  for(let i=0;i<100;i++){
    const opening=R.open(state,`open-${i}`,()=>i%2?0:.99999);
    assert.equal(R.open(state,`open-${i}`,()=>.4),opening);
    assert.equal(state.rewards.balance,initial-(i+1)*6);
    R.validate(state);
  }
  assert.equal(new Set(state.rewards.openings.map(o=>o.catId)).size,100);
  assert.equal(state.rewards.balance,2);
  assert.throws(()=>R.open(state,'open-full'),/全部收集/);
});
test('insufficient stars and invalid random values cannot consume stars or add a cat',()=>{
  const state=E.emptyState();session(state,'g-1',10);R.settle(state);
  assert.throws(()=>R.open(state,'open'),/凑齐/);assert.equal(state.rewards.balance,2);
  for(let i=2;i<=3;i++){session(state,`g-${i}`,10);R.settle(state);}
  assert.throws(()=>R.open(state,'open',()=>1),/重试/);assert.equal(state.rewards.balance,6);
  assert.equal(state.rewards.openings.length,0);
});
test('corrupt reward balances, duplicate cats, bad receipts and mismatched sessions are rejected',()=>{
  const state=E.emptyState();for(let i=0;i<6;i++){session(state,`g-${i}`,10);R.settle(state);}
  R.open(state,'o-1',()=>0);R.open(state,'o-2',()=>0);E.validateState(state,bank);
  for(const corrupt of [
    s=>s.rewards.balance++,
    s=>s.rewards.openings[1].catId=s.rewards.openings[0].catId,
    s=>s.rewards.settlements[0].units=1,
    s=>s.rewards.settlements.push({...s.rewards.settlements[0]}),
    s=>s.session.results[0].correct=false,
  ]){
    const bad=structuredClone(state);corrupt(bad);assert.throws(()=>E.validateState(bad,bank),/奖励/);
  }
});
test('storage preserves old history and restores stars, receipts and collected cats with a complete backup',async()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  const store=S.create(storage,E,{request:async(k,fn)=>fn()}),state=E.emptyState();
  E.syncBatches(bank,state);
  const q=bank.questions[0];E.grade(bank,state,q.id,q.answer,false);const history=structuredClone(state.history);
  store.read();await store.write({bank,state});
  assert.equal(store.read().state.rewards,undefined);
  for(let i=0;i<3;i++){session(state,`g-${i}`,10);R.settle(state);}
  R.open(state,'open',()=>.4);await store.write({bank,state});
  const backup=JSON.parse(JSON.stringify(store.read()));
  await store.write(backup,{restore:true});
  const restored=store.read().state;
  assert.deepEqual(restored.history,history);assert.deepEqual(restored.rewards,state.rewards);
  const merged=E.mergeBank(bank,bank);E.validateState(restored,merged);assert.equal(restored.rewards.openings.length,1);
});
test('two tabs cannot spend the same three stars',async()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
  const locks={request:async(k,fn)=>fn()},first=S.create(storage,E,locks),second=S.create(storage,E,locks);
  const state=E.emptyState();for(let i=0;i<3;i++){session(state,`g-${i}`,10);R.settle(state);}
  first.read();await first.write({bank,state});
  const a=first.read(),b=second.read();R.open(a.state,'tab-a',()=>0);R.open(b.state,'tab-b',()=>.9);
  await first.write(a);await assert.rejects(()=>second.write(b),S.ConflictError);
  const stored=second.read().state.rewards;assert.equal(stored.balance,0);assert.equal(stored.openings.length,1);
  assert.equal(stored.openings[0].catId,'cat-001');
});
