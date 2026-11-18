const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),bank=require('../question-bank.json'),S=require('../storage');
const copy=x=>structuredClone(x);
function learned(){
  const s=E.emptyState();E.syncBatches(bank,s,'2026-11-18');return s;
}
function memory(raw=null){
  const data=new Map(raw===null?[]:[[S.KEY,raw]]);
  return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),data};
}
function locks(){
  let queue=Promise.resolve();
  return {request:(key,fn)=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;}};
}
test('corrupt stored data is copied and never replaced by an empty startup state',async()=>{
  const raw=JSON.stringify({bank,state:{...learned(),settings:{size:99}}}),storage=memory(raw);
  const store=S.create(storage,E,locks());
  assert.throws(()=>store.read());
  await assert.rejects(store.write({bank,state:learned()}),/原始记录/);
  assert.equal(storage.getItem(S.KEY),raw);
  assert.equal(store.recovery(),raw);
  await store.write({bank,state:learned()},{restore:true});
  assert.equal(storage.getItem(S.KEY+'-before-restore'),raw);
  assert.equal(JSON.parse(storage.getItem(S.KEY)).revision,1);
});
test('quota failure preserves original; recovery is available even if copying fails',async()=>{
  const storage=memory('broken'),write=storage.setItem;
  storage.setItem=()=>{throw new Error('quota');};
  const store=S.create(storage,E,locks());assert.throws(()=>store.read());
  assert.equal(store.recovery(),'broken');assert.equal(storage.getItem(S.KEY),'broken');
  storage.setItem=write;
});
test('two tabs cannot replace each other’s answers, even during simultaneous writes',async()=>{
  const storage=memory(JSON.stringify({bank,state:learned(),revision:8})),lock=locks();
  const a=S.create(storage,E,lock),b=S.create(storage,E,lock);
  const sa=a.read(),sb=b.read(),q=bank.questions[0];
  E.grade(bank,sa.state,q.id,q.answer,false,'2026-11-18');sb.state.settings.size=10;
  const result=await Promise.allSettled([a.write(sa),b.write(sb)]);
  assert.equal(result[0].status,'fulfilled');assert.equal(result[1].reason.name,'ConflictError');
  assert.equal(JSON.parse(storage.getItem(S.KEY)).state.history.length,1);
  const fresh=b.read();fresh.state.settings.size=10;await b.write(fresh);
  const saved=JSON.parse(storage.getItem(S.KEY));
  assert.equal(saved.state.history.length,1);assert.equal(saved.state.settings.size,10);assert.equal(saved.revision,10);
});
test('first date cannot move past local or published repeat, with no partial mutation',()=>{
  const s=learned();
  E.addRepeat(bank,s,'l2-01','lv','2026-11-18','2026-11-18');
  const before=JSON.stringify(s);
  assert.throws(()=>E.setModuleDate(bank,s,'l2-01','lv','2026-12-01','2026-11-18'),/复读/);
  assert.equal(JSON.stringify(s),before);
  const b=copy(bank);
  b.batches=[{id:'first',learnedOn:'2026-11-15',items:[{lessonId:'l2-01',modules:['lv']}]},{id:'repeat',learnedOn:'2026-11-18',items:[{lessonId:'l2-01',modules:['lv']}]}];
  assert.throws(()=>E.setModuleDate(b,learned(),'l2-01','lv','2026-11-19','2026-11-18'),/复读/);
});
test('already inconsistent old dates use the explicit first date on every sync',()=>{
  const s=learned();E.addRepeat(bank,s,'l2-01','lv','2026-11-18','2026-11-18');
  s.moduleDates['l2-01--lv']='2026-12-01';
  for(let i=0;i<3;i++)E.syncBatches(bank,s,'2026-11-18');
  assert.equal(s.learningDates['l2-01-days'],'2026-12-01');
  assert.equal(s.points['l2-01-days'].due,'2026-12-02');
  assert(!E.activePoints(bank,s,'2026-11-18').some(p=>p.module==='lv'));
});
test('snapshot removals retire questions and preserve historical answers',()=>{
  const s=learned(),q=bank.questions[0];E.grade(bank,s,q.id,q.answer,false,'2026-11-18');
  const b=copy(bank);b.revision++;b.questions=b.questions.filter(x=>x.id!==q.id);
  const merged=E.mergeBank(bank,b);
  E.validateState(s,merged);
  assert.equal(merged.questions.find(x=>x.id===q.id).active,false);
  assert(!E.plan(merged,s,{practice:true,today:'2026-11-19',size:100}).includes(q.id));
  assert.equal(s.history.length,1);
});
test('published question identities cannot be reassigned and old bank revisions cannot return',()=>{
  for(const field of ['answer','pointId','options','prompt']){
    const b=copy(bank);
    b.questions[0][field]=field==='answer'?1:field==='pointId'?bank.points[1].id:field==='options'?['a','b','c']: 'changed';
    assert.throws(()=>E.mergeBank(bank,b));
  }
  const b=copy(bank);b.revision--;assert.throws(()=>E.mergeBank(bank,b),/版本/);
});
test('persisted hints survive serialization; assisted high mastery restarts with short intervals',()=>{
  let s=learned();const q=bank.questions.find(q=>q.type==='listening'),key=E.unitKey(q);
  s.units[key]={stage:4,due:'2026-11-18',lastDay:'2026-11-01',missDay:null,errors:0};
  s.session={items:[q.id],index:0,day:'2026-11-18',results:[],hints:{[q.id]:true}};
  s=E.validateState(JSON.parse(JSON.stringify(s)),bank);
  const h=E.grade(bank,s,q.id,q.answer,false,'2026-11-18');
  assert.equal(h.help,true);assert.equal(s.units[key].stage,0);
  s.session=null;
  E.grade(bank,s,q.id,q.answer,false,'2026-11-19');
  assert.equal(s.units[key].stage,1);assert.equal(s.units[key].due,'2026-11-20');
  E.grade(bank,s,q.id,q.answer,false,'2026-11-19');assert.equal(s.units[key].stage,1);
});
test('answering Monday does not defer Tuesday or claim mastery of all weekdays',()=>{
  const s=learned(),q=bank.questions[0],tuesday=bank.questions[1],oldDue=s.units[E.unitKey(tuesday)].due;
  E.grade(bank,s,q.id,q.answer,false,'2026-11-18');
  assert.equal(s.units[E.unitKey(q)].stage,1);assert.equal(s.units[E.unitKey(tuesday)].stage,0);
  assert.equal(s.units[E.unitKey(tuesday)].due,oldDue);assert.equal(s.points[q.pointId].stage,0);
  const plan=E.plan(bank,s,{today:'2026-11-18',size:10});
  assert(!plan.includes(q.id));assert.equal(new Set(plan.map(id=>E.unitKey(bank.questions.find(q=>q.id===id)))).size,plan.length);
});
test('one due point yields at most two different units, without padding a set to six',()=>{
  const s=learned();
  for(const p of bank.points)if(p.id!=='l2-01-days')s.paused[p.id]=true;
  const ids=E.plan(bank,s,{today:'2026-11-18',size:6});
  assert.equal(ids.length,2);
  assert.notEqual(E.unitKey(bank.questions.find(q=>q.id===ids[0])),E.unitKey(bank.questions.find(q=>q.id===ids[1])));
});
test('legacy aggregate mastery migrates conservatively while history remains intact',()=>{
  const old=copy(bank);for(const q of old.questions)delete q.reviewUnit;
  const s=E.emptyState();E.syncBatches(old,s,'2026-11-18');
  const q=old.questions[0];E.grade(old,s,q.id,q.answer,false,'2026-11-18');
  s.points[q.pointId].stage=5;
  const history=JSON.stringify(s.history);
  E.syncBatches(bank,s,'2026-11-19');
  assert.equal(JSON.stringify(s.history),history);
  assert.equal(s.points[q.pointId].stage,0);
  assert.equal(s.units[E.unitKey(bank.questions[0])].due,'2026-11-19');
  const after=JSON.stringify(s);E.syncBatches(bank,s,'2026-11-19');assert.equal(JSON.stringify(s),after);
});
