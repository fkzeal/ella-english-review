const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),bank=require('./bank-fixture').publishedBank;
const date='2026-11-18';
const question=id=>bank.questions.find(q=>q.id===id);
const lesson=id=>bank.points.find(p=>p.id===question(id).pointId).lessonId;
function state(){const s=E.emptyState();E.syncBatches(bank,s,date);return s;}

test('new group sizes persist and planning reaches the cap without repeating units',()=>{
  for(const size of [6,10,15,20]){
    const s=state();s.settings.size=size;
    E.validateState(s,bank);
    const ids=E.plan(bank,s,{today:date,rng:()=>.5});
    assert.equal(ids.length,size);
    assert.equal(new Set(ids.map(id=>E.unitKey(question(id)))).size,size);
  }
  const s=state();s.settings.size=20;
  const ids=E.plan(bank,s,{today:date,lessonId:'raz-d-animal-tongues',rng:()=>.5});
  const targets=E.targetKeys(bank);
  const available=new Set(bank.questions.filter(q=>lesson(q.id)==='raz-d-animal-tongues').map(q=>targets.get(q.id)));
  assert.equal(ids.length,Math.min(20,available.size));
  assert.equal(new Set(ids.map(id=>targets.get(id))).size,ids.length);
});
test('legacy eight-question settings upgrade without changing history or the active set',()=>{
  const s=state(),q=question('gt-veg-q01');
  E.grade(bank,s,q.id,q.answer,false,date);
  s.settings.size=8;s.session={items:[q.id],index:0,results:[],day:date};
  const history=structuredClone(s.history),session=structuredClone(s.session);
  E.validateState(s,bank);
  assert.equal(s.settings.size,10);
  assert.deepEqual(s.history,history);assert.deepEqual(s.session,session);
});
test('a backlog rotates all three courses even when every unit in one book is weak',()=>{
  const s=state();
  for(const q of bank.questions.filter(q=>lesson(q.id)==='raz-d-greater-than')){
    s.units[E.unitKey(q)]={stage:0,due:'2026-11-17',lastDay:'2026-11-16',missDay:'2026-11-16',errors:8};
  }
  E.syncUnits(bank,s,date);
  const ids=E.plan(bank,s,{today:date,size:6,rng:()=>.5});
  assert.equal(ids.length,6);
  assert.equal(new Set(ids.slice(0,3).map(lesson)).size,3);
  for(const id of new Set(ids.map(lesson)))assert.equal(ids.filter(q=>lesson(q)===id).length,2);
  assert.equal(new Set(ids.map(id=>E.unitKey(question(id)))).size,ids.length);
});
test('when a set cannot cover all courses the unvisited course gets the next turn',()=>{
  const s=state(),ids=E.plan(bank,s,{today:date,size:2,rng:()=>.5});
  assert.equal(new Set(ids.map(lesson)).size,2);
  for(const id of ids)E.grade(bank,s,id,question(id).answer,false,date);
  const next=E.plan(bank,s,{today:date,size:2,rng:()=>.5});
  assert(!ids.map(lesson).includes(lesson(next[0])));
});
test('a still-weak unit outranks a new unit even after a sibling was answered correctly',()=>{
  const s=state(),weak=question('at-features-q03'),strong=question('at-features-q01');
  s.units[E.unitKey(weak)]={stage:0,due:date,lastDay:'2026-11-16',missDay:'2026-11-16',errors:1};
  s.units[E.unitKey(strong)]={stage:2,due:'2026-11-24',lastDay:'2026-11-17',missDay:null,errors:0};
  E.syncUnits(bank,s,date);
  const ids=E.plan(bank,s,{today:date,lessonId:'raz-d-animal-tongues',size:1,rng:()=>.5});
  assert.equal(ids[0],weak.id);
});
test('real review units follow checkpoints; misses and overdue reviews do not compound missed sessions',()=>{
  const s=state(),q=question('gt-veg-q01'),key=E.unitKey(q);
  E.setModuleDate(bank,s,'raz-d-greater-than','lv',date,date);
  assert.equal(s.units[key].due,'2026-11-19');
  for(const [when,next] of [
    ['2026-11-19','2026-11-21'],['2026-11-21','2026-11-25'],
    ['2026-11-25','2026-12-02'],['2026-12-02','2026-12-18'],['2026-12-18','2027-01-17']
  ]){
    E.grade(bank,s,q.id,q.answer,false,when);assert.equal(s.units[key].due,next);
  }
  E.grade(bank,s,q.id,q.answer,true,'2027-01-17');
  assert.equal(s.units[key].due,'2027-01-18');assert.equal(s.units[key].stage,0);
  E.grade(bank,s,q.id,q.answer,false,'2027-01-18');assert.equal(s.units[key].due,'2027-01-19');
  const late=state();
  E.grade(bank,late,q.id,q.answer,false,'2026-11-30');
  assert.equal(late.units[key].stage,1);assert.equal(late.units[key].due,'2026-12-03');
});
test('target audit changes neither published question identity nor existing progress',()=>{
  const old=structuredClone(bank);
  old.revision--;
  for(const l of old.lessons)delete l.learningTargets;
  const s=state(),q=question('at-features-q04');
  E.grade(old,s,q.id,q.answer,false,date);
  const before=JSON.stringify(s);
  const merged=E.mergeBank(old,bank);E.syncBatches(merged,s,date);
  assert.equal(JSON.stringify(s),before);
  assert.deepEqual(merged.questions,old.questions);
  for(const l of bank.lessons.filter(l=>l.learningTargets)){
    const ids=l.learningTargets.flatMap(t=>t.questionIds);
    assert.equal(new Set(ids).size,ids.length);
    const lessonQuestions=bank.questions.filter(q=>lesson(q.id)===l.id);
    const activeQuestions=lessonQuestions.filter(q=>q.active!==false);
    const coveredQuestions=activeQuestions.length?activeQuestions:lessonQuestions;
    assert.equal(ids.length,coveredQuestions.length);
    assert.deepEqual(new Set(ids),new Set(coveredQuestions.map(q=>q.id)));
  }
  const duplicate=structuredClone(bank),targets=duplicate.lessons.find(l=>l.learningTargets).learningTargets;
  targets[1].questionIds.push(targets[0].questionIds[0]);
  assert.throws(()=>E.validateBank(duplicate),/重复/);
});
