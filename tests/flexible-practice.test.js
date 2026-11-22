const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),bank=require('../question-bank.json');
const today='2026-11-22',keys=E.targetKeys(bank);
function futureState(){
  const state=E.emptyState();E.syncBatches(bank,state,today);
  for(const unit of Object.values(state.units))unit.due='2026-12-01';
  for(const point of Object.values(state.points))point.due='2026-12-01';
  return state;
}
test('one primary plan continues into future work without changing the schedule',()=>{
  const state=futureState(),before=structuredClone(state);
  assert.equal(E.plan(bank,state,{today}).length,0);
  const ids=E.plan(bank,state,{today,flexible:true,size:20});
  assert.equal(ids.length,20);
  assert.equal(new Set(ids.map(id=>keys.get(id))).size,ids.length);
  assert.deepEqual(state,before);
});
test('unseen targets are screened even when only one sibling unit is due today',()=>{
  const state=futureState();
  const qs=E.availableQuestions(bank).filter(q=>E.activePoints(bank,state,today).some(p=>p.id===q.pointId));
  const seen=new Set(),unique=qs.filter(q=>!seen.has(keys.get(q.id))&&seen.add(keys.get(q.id)));
  const [due,tomorrow]=unique;
  state.units[E.unitKey(due)].due=today;
  state.units[E.unitKey(tomorrow)].due=E.plusDay(today,1);
  E.syncUnits(bank,state,today);
  const ids=E.plan(bank,state,{today,flexible:true,size:2,rng:()=>.5});
  assert.equal(ids.length,2);
  assert.equal(new Set(ids.map(id=>keys.get(id))).size,2);
  assert(E.coveragePlan(bank,state,{today,size:2}).entries.every(item=>item.reason==='first'));
});
test('willing learners can continue after every target has been practised twice',()=>{
  const state=futureState();
  for(const q of E.availableQuestions(bank)){
    E.grade(bank,state,q.id,q.answer,false,today);
    E.grade(bank,state,q.id,q.answer,false,today);
  }
  const before=structuredClone(state);
  assert.equal(E.plan(bank,state,{today,practice:true}).length,0);
  const ids=E.plan(bank,state,{today,flexible:true,size:6});
  assert.equal(ids.length,6);
  assert.equal(new Set(ids.map(id=>keys.get(id))).size,6);
  assert.deepEqual(state,before);
});
test('early success keeps the planned review; early error requires next-day consolidation',()=>{
  const state=futureState();
  const id=E.plan(bank,state,{today,flexible:true,size:1})[0],q=bank.questions.find(q=>q.id===id);
  const before=structuredClone(state.units[E.unitKey(q)]);
  E.grade(bank,state,id,q.answer,false,today);
  assert.equal(state.units[E.unitKey(q)].due,before.due);
  assert.equal(state.units[E.unitKey(q)].stage,before.stage);
  E.grade(bank,state,id,(q.answer+1)%q.options.length,false,today);
  assert.equal(state.units[E.unitKey(q)].due,E.plusDay(today,1));
  assert.equal(state.units[E.unitKey(q)].stage,0);
});
test('lookahead does not activate courses whose first learning date has not arrived',()=>{
  const state=futureState(),lesson='raz-d-animal-tongues';
  for(const module of new Set(bank.points.filter(p=>p.lessonId===lesson).map(p=>p.module)))
    E.setModuleDate(bank,state,lesson,module,E.plusDay(today,3));
  const ids=E.plan(bank,state,{today,flexible:true,size:1000});
  assert(ids.length>0);
  assert(ids.every(id=>bank.points.find(p=>p.id===bank.questions.find(q=>q.id===id).pointId).lessonId!==lesson));
});
