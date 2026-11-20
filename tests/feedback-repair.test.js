const test=require('node:test'),assert=require('node:assert/strict');
const bank=require('../question-bank.json'),E=require('../engine'),{check}=require('../scripts/check-feedback-repair');
function candidate(){
  const next=structuredClone(bank);next.revision++;
  return next;
}
function replacement(){
  const next=candidate(),old=next.questions[0],fixed={...structuredClone(old),id:old.id+'-fixed',reviewUnit:old.reviewUnit+'-fixed',explanation:old.explanation+' 核对后的解析。'};
  old.active=false;next.questions.push(fixed);
  for(const l of next.lessons)for(const t of l.learningTargets||[])t.questionIds=t.questionIds.map(id=>id===old.id?fixed.id:id);
  return {next,old,fixed,repairs:[{recordIds:['qa-record'],oldQuestionId:old.id,newQuestionId:fixed.id}]};
}
test('reviewed metadata fixes keep identity while evaluation changes require a new question',()=>{
  const next=candidate(),q=next.questions[0],repairs=[{recordIds:['qa-record'],oldQuestionId:q.id,newQuestionId:q.id}];
  q.explanation+=' 核对后的解析。';
  assert.equal(check(bank,next,repairs).repairs,1);
  q.answer=(q.answer+1)%q.options.length;
  assert.throws(()=>check(bank,next,repairs),/不能替换/);
});
test('replacement retires old questions and schedules a fresh unit without deleting answer history',()=>{
  const {next,old,fixed,repairs}=replacement();
  assert.equal(check(bank,next,repairs).repairs,1);
  const state=E.emptyState();E.syncBatches(bank,state);
  E.grade(bank,state,old.id,old.answer,false,E.day());
  const history=structuredClone(state.history),merged=E.mergeBank(bank,next);
  E.validateState(state,merged);E.syncUnits(merged,state);
  assert.deepEqual(state.history,history);
  assert.equal(state.units[E.unitKey(fixed)].stage,0);
  assert.equal(state.units[E.unitKey(fixed)].due,E.day());
  assert(!E.availableQuestions(merged).some(q=>q.id===old.id));
});
test('repair validation rejects inherited mastery, changed course dates and missing old questions',()=>{
  const {next,old,fixed,repairs}=replacement();
  fixed.reviewUnit=old.reviewUnit;
  assert.throws(()=>check(bank,next,repairs),/新复习单元/);
  fixed.reviewUnit=old.reviewUnit+'-fixed';
  next.lessons[0].moduleGeneratedOn.lv='2026-01-01';
  assert.throws(()=>check(bank,next,repairs),/生成日期/);
  next.lessons[0].moduleGeneratedOn=structuredClone(bank.lessons[0].moduleGeneratedOn);
  next.questions=next.questions.filter(q=>q.id!==old.id);
  assert.throws(()=>check(bank,next,repairs),/必须保留历史/);
});
