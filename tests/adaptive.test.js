const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),bank=require('../question-bank.json');
function masteredState(){
  const state=E.emptyState();E.syncBatches(bank,state,'2026-11-21');
  const seen=new Set(),questions=E.availableQuestions(bank).filter(q=>!seen.has(E.unitKey(q))&&seen.add(E.unitKey(q)));
  for(const q of questions){
    for(const day of ['2026-11-01','2026-11-07','2026-11-15'])E.grade(bank,state,q.id,q.answer,false,day);
    Object.assign(state.units[E.unitKey(q)],{stage:3,due:'2026-12-01',missDay:null});
  }
  E.syncUnits(bank,state,'2026-11-21');return {state,questions};
}
test('mastered units shrink optional practice but still appear when scheduled review is due',()=>{
  const {state}=masteredState();
  assert.equal(E.plan(bank,state,{practice:true,size:6,today:'2026-11-21'}).length,1);
  assert.equal(E.plan(bank,state,{practice:true,size:20,today:'2026-11-21'}).length,5);
  assert.equal(E.plan(bank,state,{size:6,today:'2026-12-01'}).length,6);
});
test('a new error or assistance restores practice priority; repeated same-day success is not mastery',()=>{
  const {state,questions}=masteredState(),q=questions[0],other=questions[1];
  E.grade(bank,state,q.id,(q.answer+1)%q.options.length,false,'2026-11-21');
  E.grade(bank,state,other.id,other.answer,true,'2026-11-21');
  const plan=E.plan(bank,state,{practice:true,size:6,today:'2026-11-21'});
  assert(plan.some(id=>E.unitKey(bank.questions.find(q=>q.id===id))===E.unitKey(q)));
  assert(plan.some(id=>E.unitKey(bank.questions.find(q=>q.id===id))===E.unitKey(other)));
  const raw=E.emptyState();E.syncBatches(bank,raw,'2026-11-21');
  for(const q of questions)for(let n=0;n<3;n++)E.grade(bank,raw,q.id,q.answer,false,'2026-11-21');
  assert.equal(E.plan(bank,raw,{practice:true,size:6,today:'2026-11-21'}).length,6);
});
