const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),bank=require('../question-bank.json');
const copy=value=>structuredClone(value);
function retireLesson(){
  const incoming=copy(bank),id='raz-d-greater-than';
  incoming.revision++;
  incoming.lessons=incoming.lessons.filter(l=>l.id!==id);
  incoming.points=incoming.points.filter(p=>p.lessonId!==id);
  incoming.questions=incoming.questions.filter(q=>incoming.points.some(p=>p.id===q.pointId));
  incoming.batches=(incoming.batches||[]).map(b=>({...b,items:b.items.filter(i=>i.lessonId!==id)})).filter(b=>b.items.length);
  return incoming;
}
test('a complete lesson can retire from a real snapshot while history, targets and backups remain valid',()=>{
  const incoming=retireLesson(),s=E.emptyState();
  E.validateBank(incoming);E.syncBatches(bank,s,'2026-11-18');
  const q=bank.questions.find(q=>q.id==='gt-veg-q01');
  E.grade(bank,s,q.id,q.answer,false,'2026-11-18');
  s.session={items:[q.id],index:0,results:[],day:'2026-11-18'};
  const before=JSON.stringify(s),merged=E.mergeBank(bank,incoming);
  assert.equal(JSON.stringify(E.validateState(s,merged)),before);
  assert.deepEqual(merged.lessons.find(l=>l.id==='raz-d-greater-than').learningTargets,
    bank.lessons.find(l=>l.id==='raz-d-greater-than').learningTargets);
  assert.equal(merged.questions.find(x=>x.id===q.id).active,false);
  assert(!E.activePoints(merged,s,'2026-11-18').some(p=>p.lessonId==='raz-d-greater-than'));
  assert(!E.plan(merged,s,{practice:true,today:'2026-11-18'}).includes(q.id));
  assert.deepEqual(E.mergeBank(merged,incoming),merged);
  E.validateBank(JSON.parse(JSON.stringify(merged)));
  const invalid=copy(merged);
  invalid.lessons.find(l=>l.id==='raz-d-greater-than').learningTargets[0].questionIds[0]='missing-question';
  assert.throws(()=>E.validateBank(invalid),/引用错误/);
  const partial=copy(bank);partial.questions.find(x=>x.id===q.id).active=false;
  assert.throws(()=>E.validateBank(partial),/学习目标题目/);
});
test('patch target references resolve against the real existing bank, with invalid updates rejected',()=>{
  const original=bank.questions.find(q=>q.id==='gt-veg-q01');
  const lesson=copy(bank.lessons.find(l=>l.id==='raz-d-greater-than'));
  const variant={...copy(original),id:'gt-veg-extra-review',prompt:'Which option means carrots?'};
  lesson.learningTargets.find(t=>t.questionIds.includes(original.id)).questionIds.push(variant.id);
  const patch={version:1,revision:bank.revision+1,mode:'patch',lessons:[lesson],points:[],questions:[variant]};
  const before=JSON.stringify(bank),merged=E.mergeBank(bank,patch);
  assert.equal(merged.questions.length,bank.questions.length+1);assert.equal(JSON.stringify(bank),before);
  assert.deepEqual(merged.questions.find(q=>q.id===original.id),original);
  const s=E.emptyState();E.syncBatches(bank,s,'2026-11-18');
  E.grade(bank,s,original.id,original.answer,false,'2026-11-18');
  const stateBefore=JSON.stringify(s);E.validateState(s,merged);E.syncBatches(merged,s,'2026-11-18');
  assert.equal(JSON.stringify(s),stateBefore);
  assert.deepEqual(E.mergeBank(merged,patch),merged);
  for(const invalid of [
    {...copy(patch),questions:[variant,variant]},
    {...copy(patch),questions:[{...variant,id:'__proto__'}]},
    {...copy(patch),questions:[{...variant,pointId:'missing-point'}]},
    {...copy(patch),questions:[{...variant,answer:99}]},
    {...copy(patch),questions:[{...copy(original),answer:1-original.answer}]},
    {...copy(patch),revision:bank.revision-1},
    {...copy(patch),mode:'unknown'},
    {...copy(patch),batches:[{id:'duplicate'},{id:'duplicate'}]}
  ])assert.throws(()=>E.mergeBank(bank,invalid));
  const missing=copy(patch);missing.lessons[0].learningTargets[0].questionIds.push('missing-question');
  assert.throws(()=>E.mergeBank(bank,missing),/引用错误/);
});
test('late repeated learning schedules each unit by its own answer date, including previously receipted events',()=>{
  const s=E.emptyState();E.syncBatches(bank,s,'2026-11-01');
  E.setModuleDate(bank,s,'raz-d-greater-than','lv','2026-11-01','2026-11-01');
  const a=bank.questions.find(q=>q.id==='gt-veg-q01'),b=bank.questions.find(q=>q.id==='gt-veg-q02');
  for(const date of ['2026-11-02','2026-11-04','2026-11-08','2026-11-15'])E.grade(bank,s,a.id,a.answer,false,date);
  E.grade(bank,s,b.id,b.answer,false,'2026-11-19');
  const incoming=copy(bank);incoming.revision++;incoming.batches=[
    {id:'confirmed-first',learnedOn:'2026-11-01',items:[{lessonId:'raz-d-greater-than',modules:['lv']}]},
    {id:'confirmed-repeat',learnedOn:'2026-11-18',items:[{lessonId:'raz-d-greater-than',modules:['lv']}]}
  ];
  const merged=E.mergeBank(bank,incoming),unitBefore=copy(s.units[E.unitKey(a)]),sibling=copy(s.units[E.unitKey(b)]),history=copy(s.history);
  assert.equal(unitBefore.due,'2026-12-01');assert.equal(s.points[a.pointId].lastDay,'2026-11-19');
  const receipt='confirmed-repeat--raz-d-greater-than--lv';
  // A prior client may have written the receipt without adjusting this unit.
  s.batchReceipts[receipt]=JSON.stringify({learnedOn:'2026-11-18',items:incoming.batches[1].items});
  E.syncBatches(merged,s,'2026-11-20');
  assert.deepEqual(s.units[E.unitKey(a)],{...unitBefore,due:'2026-11-19'});
  assert.deepEqual(s.units[E.unitKey(b)],sibling);assert.deepEqual(s.history,history);
  E.validateState(s,merged);
  const once=JSON.stringify(s);E.syncBatches(merged,s,'2026-11-21');assert.equal(JSON.stringify(s),once);
  E.grade(merged,s,a.id,a.answer,false,'2026-11-21');
  const answered=copy(s.units[E.unitKey(a)]);E.syncBatches(merged,s,'2026-11-22');
  assert.deepEqual(s.units[E.unitKey(a)],answered);
});
