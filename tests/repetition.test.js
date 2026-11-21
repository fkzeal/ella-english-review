const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),bank=require('../question-bank.json');
const today='2026-11-21',keys=E.targetKeys(bank);
function state(){const s=E.emptyState();E.syncBatches(bank,s,today);return s;}
const targets=new Map();
for(const q of E.availableQuestions(bank)){
  const key=keys.get(q.id);if(!targets.has(key))targets.set(key,[]);
  targets.get(key).push(q);
}
const variants=[...targets.values()].find(qs=>new Set(qs.map(E.unitKey)).size>=3);
const lessonId=bank.points.find(p=>p.id===variants[0].pointId).lessonId;
test('all normal and optional groups contain at most one question per learning target',()=>{
  for(const practice of [false,true]){
    const s=state(),before=structuredClone(s);
    const ids=E.plan(bank,s,{today,practice,size:20,rng:()=>.5});
    assert.equal(new Set(ids.map(id=>keys.get(id))).size,ids.length);
    assert.equal(new Set(ids.map(id=>E.unitKey(bank.questions.find(q=>q.id===id)))).size,ids.length);
    assert.deepEqual(s,before);
  }
});
test('two daily attempts cap every variant across review and optional practice without rewriting due dates',()=>{
  const s=state(),[a,b]=variants;
  E.grade(bank,s,a.id,a.answer,false,today);
  E.grade(bank,s,b.id,b.answer,false,today);
  const before=structuredClone(s),target=keys.get(a.id);
  for(const practice of [false,true]){
    const ids=E.plan(bank,s,{today,practice,lessonId,size:20,rng:()=>.5});
    assert(!ids.some(id=>keys.get(id)===target));
  }
  const availability=E.reviewAvailability(bank,s,today);
  assert(availability.deferred>0);
  assert.equal(availability.due,availability.ready+availability.deferred);
  assert.deepEqual(s,before);
  assert(E.plan(bank,s,{today:E.plusDay(today,1),lessonId,size:20,rng:()=>.5}).some(id=>keys.get(id)===target));
});
test('unpractised targets take a turn before another correct variant of a practised target',()=>{
  const s=state(),a=variants[0];
  E.grade(bank,s,a.id,a.answer,false,today);
  const ids=E.plan(bank,s,{today,lessonId,size:1,rng:()=>.5});
  assert.equal(ids.length,1);
  assert.notEqual(keys.get(ids[0]),keys.get(a.id));
});
test('a daily cap does not clear errors; the wrong unit is prioritised tomorrow',()=>{
  const s=state(),[a,b]=variants;
  E.grade(bank,s,a.id,(a.answer+1)%a.options.length,false,today);
  E.grade(bank,s,b.id,b.answer,false,today);
  const before=structuredClone(s.units[E.unitKey(a)]);
  E.plan(bank,s,{today,practice:true,lessonId,size:20});
  assert.deepEqual(s.units[E.unitKey(a)],before);
  assert.equal(before.stage,0);assert.equal(before.due,'2026-11-22');
  const ids=E.plan(bank,s,{today:'2026-11-22',lessonId,size:1,rng:()=>.5});
  assert.equal(E.unitKey(bank.questions.find(q=>q.id===ids[0])),E.unitKey(a));
});
test('legacy targets fall back to stable unit keys and preview remains uncapped',()=>{
  const legacy=structuredClone(bank);for(const l of legacy.lessons)delete l.learningTargets;
  const s=state(),q=variants[0];
  E.grade(bank,s,q.id,q.answer,false,today);E.grade(bank,s,q.id,q.answer,false,today);
  assert.equal(E.targetKeys(legacy).get(q.id),E.unitKey(q));
  assert(!E.plan(legacy,s,{today,practice:true,size:20}).includes(q.id));
  const before=E.plan(bank,state(),{today,practice:true,preview:true,lessonId,size:20});
  const after=E.plan(bank,s,{today,practice:true,preview:true,lessonId,size:20});
  assert.equal(after.length,before.length);
  assert(after.some(id=>keys.get(id)===keys.get(q.id)));
});
