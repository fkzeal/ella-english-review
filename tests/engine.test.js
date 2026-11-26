const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),{publishedBank,cambridgeBank}=require('./bank-fixture'),bank=cambridgeBank();
test('Scholastic validates original numeric level and participates in normal practice without changing existing records',()=>{
  const b=structuredClone(publishedBank),l=b.lessons.find(l=>l.system==='scholastic');
  assert(l);assert.equal(l.level,3);assert.equal(l.learningTargets.length,9);
  E.validateBank(b);
  const invalid=structuredClone(b);invalid.lessons.find(x=>x.id===l.id).level='D';
  assert.throws(()=>E.validateBank(invalid),/信息不完整/);
  const state=E.emptyState();E.syncBatches(b,state,'2026-11-26');
  assert.equal(state.settings.size,10);
  const points=E.activePoints(b,state,'2026-11-26').filter(p=>p.lessonId===l.id);
  assert.equal(points.length,2);
  assert(!b.batches.some(x=>x.items.some(i=>i.lessonId===l.id)),'no invented confirmed learning batch');
});
// Legacy fixtures exercise compatibility with banks that predate review units.
for(const q of bank.questions)delete q.reviewUnit;
function enrolled(){
  const s=E.emptyState();
  for(const m of ['lv','rg','skills'])E.setLearned(bank,s,'l2-01',m,true,'2026-11-16');
  return s;
}
test('bank has unique IDs, valid answer indices, audio scripts and referenced points',()=>assert.equal(E.validateBank(publishedBank),publishedBank));
test('nothing enters review before enrollment; pending lessons cannot enroll',()=>{
  const s=E.emptyState();
  assert.deepEqual(E.plan(bank,s),[]);
  assert.throws(()=>E.setLearned(bank,s,'l2-02','lv',true));
  E.setLearned(bank,s,'l2-01','lv',true,'2026-11-16');
  assert.equal(E.activePoints(bank,s).length,2);
  assert(E.plan(bank,s,{today:'2026-11-16'}).every(id=>bank.points.find(p=>p.id===bank.questions.find(q=>q.id===id).pointId).module==='lv'));
});
test('student starter practice works without pretending a lesson has been learned',()=>{
  const s=E.emptyState();
  const ids=E.plan(bank,s,{preview:true,practice:true,lessonId:'l2-01',today:'2026-11-16',size:6});
  assert.equal(ids.length,6);
  assert.deepEqual(s.learned,{});
  assert.deepEqual(E.plan(bank,s,{today:'2026-11-16'}),[]);
});
test('new points are due today and plan spreads across due points within cap',()=>{
  const s=enrolled(),ids=E.plan(bank,s,{today:'2026-11-16',size:6,rng:()=>.5});
  assert.equal(ids.length,5);assert.equal(new Set(ids).size,5);
  assert.equal(new Set(ids.map(id=>bank.questions.find(q=>q.id===id).pointId)).size,5);
});
test('correct answers extend intervals on distinct due days, never twice the same day',()=>{
  const s=enrolled(),q=bank.questions[0];
  E.grade(bank,s,q.id,q.answer,false,'2026-11-16');
  assert.equal(s.points[q.pointId].stage,1);assert.equal(s.points[q.pointId].due,'2026-11-17');
  E.grade(bank,s,q.id,q.answer,false,'2026-11-16');
  assert.equal(s.points[q.pointId].stage,1);
  E.grade(bank,s,q.id,q.answer,false,'2026-11-17');
  assert.equal(s.points[q.pointId].stage,2);assert.equal(s.points[q.pointId].due,'2026-11-20');
});
test('incorrect or assisted answers force tomorrow; same-day correction does not erase miss',()=>{
  const s=enrolled(),q=bank.questions[0];
  E.grade(bank,s,q.id,(q.answer+1)%q.options.length,false,'2026-11-16');
  E.grade(bank,s,q.id,q.answer,false,'2026-11-16');
  assert.equal(s.points[q.pointId].stage,0);assert.equal(s.points[q.pointId].errors,1);assert.equal(s.points[q.pointId].due,'2026-11-17');
  E.grade(bank,s,q.id,q.answer,true,'2026-11-17');
  assert.equal(s.points[q.pointId].stage,0);assert.equal(s.points[q.pointId].due,'2026-11-18');
});
test('extra practice before a due date cannot advance stage or defer the due date',()=>{
  const s=enrolled(),q=bank.questions[0];
  E.grade(bank,s,q.id,q.answer,false,'2026-11-16');
  E.grade(bank,s,q.id,q.answer,false,'2026-11-17');
  E.grade(bank,s,q.id,q.answer,false,'2026-11-18');
  assert.equal(s.points[q.pointId].stage,2);assert.equal(s.points[q.pointId].due,'2026-11-20');
});
test('unseen variants are preferred over previously answered items',()=>{
  const s=enrolled(),q=bank.questions[0];
  E.grade(bank,s,q.id,q.answer,false,'2026-11-16');
  const planned=E.plan(bank,s,{today:'2026-11-17',size:5,rng:()=>.5});
  assert(!planned.includes(q.id));
});
test('unchecking preserves history and pauses a module; reenrollment preserves schedule',()=>{
  const s=enrolled(),q=bank.questions[0];
  E.grade(bank,s,q.id,q.answer,false,'2026-11-16');
  E.setLearned(bank,s,'l2-01','lv',false,'2026-11-16');
  assert(!E.activePoints(bank,s).some(p=>p.module==='lv'));
  E.setLearned(bank,s,'l2-01','lv',true,'2026-11-16');
  assert.equal(s.history.length,1);assert.equal(s.points[q.pointId].due,'2026-11-17');
});
test('content merge adds variants without changing existing learner progress',()=>{
  const s=enrolled(),update=JSON.parse(JSON.stringify(bank));
  update.questions=[{...update.questions[0],id:'additional-q'}];
  update.mode='patch';
  update.points=[update.points[0]];update.lessons=[update.lessons.find(l=>l.id===update.points[0].lessonId)];update.batches=[];
  const before=JSON.stringify(s),merged=E.mergeBank(bank,update);
  assert.equal(merged.questions.length,bank.questions.length+1);
  assert.equal(JSON.stringify(s),before);assert.equal(E.validateState(s,merged),s);
});
function dated(date='2026-11-16'){
  const b=JSON.parse(JSON.stringify(bank));
  b.batches=[{id:'study-01',learnedOn:date,items:[{lessonId:'l2-01',modules:['lv','rg','skills']}]}];
  E.validateBank(b);
  const s=E.emptyState();E.syncBatches(b,s,date);
  return {b,s};
}
test('published batches enroll automatically, with learning day +1 rather than publication day',()=>{
  const {b,s}=dated();
  assert.equal(E.activePoints(b,s).length,5);
  assert.equal(E.plan(b,s,{today:'2026-11-16'}).length,0);
  E.syncBatches(b,s,'2026-11-20');
  assert.equal(s.points[b.points[0].id].due,'2026-11-17');
  assert.equal(E.plan(b,s,{today:'2026-11-20',size:6}).length,5);
});
test('calendar follows +1,+3,+7,+14,+30 while answers stay on schedule',()=>{
  const {b,s}=dated(),q=b.questions[0];
  for(const [date,next] of [['2026-11-17','2026-11-19'],['2026-11-19','2026-11-23'],['2026-11-23','2026-11-30'],['2026-11-30','2026-12-16']]){
    E.grade(b,s,q.id,q.answer,false,date);
    assert.equal(s.points[q.pointId].due,next);
    E.grade(b,s,q.id,q.answer,false,date);
    assert.equal(s.points[q.pointId].due,next);
  }
});
test('future batches wait, then activate without a user configuration',()=>{
  const {b}=dated('2026-12-01'),s=E.emptyState();
  E.syncBatches(b,s,'2026-11-18');assert.equal(E.activePoints(b,s).length,0);
  E.syncBatches(b,s,'2026-12-01');assert.equal(E.activePoints(b,s,'2026-12-01').length,5);
  assert.equal(s.points[b.points[0].id].due,'2026-12-02');
});
test('repeated syncing and newly added variants preserve history, session and mastery',()=>{
  const {b,s}=dated(),q=b.questions[0];
  E.grade(b,s,q.id,q.answer,false,'2026-11-17');
  const original=JSON.stringify(s);
  E.syncBatches(b,s,'2026-11-18');assert.equal(JSON.stringify(s),original);
  const update=JSON.parse(JSON.stringify(b));
  update.questions.push({...q,id:'new-variant'});
  const merged=E.mergeBank(b,update);
  E.syncBatches(merged,s,'2026-11-18');assert.equal(JSON.stringify(s),original);
});
test('date correction moves only unreviewed schedules; repeat reading cannot raise mastery',()=>{
  const {b,s}=dated(),q=b.questions[0];
  E.grade(b,s,q.id,q.answer,false,'2026-11-17');
  const oldDue=s.points[q.pointId].due;
  b.batches[0].learnedOn='2026-11-14';
  E.syncBatches(b,s,'2026-11-18');
  assert.equal(s.points[q.pointId].due,oldDue);
  assert.equal(s.points[b.points[1].id].due,'2026-11-15');
  b.batches.push({id:'repeat-01',learnedOn:'2026-11-18',items:[{lessonId:'l2-01',modules:['lv']}]});
  E.syncBatches(b,s,'2026-11-18');assert.equal(s.points[q.pointId].stage,1);
  assert.equal(s.history.length,1);
});
test('legacy unchecked content resumes automatically without losing progress',()=>{
  const {b,s}=dated();
  const q=b.questions[0];E.grade(b,s,q.id,q.answer,false,'2026-11-18');
  const history=structuredClone(s.history),unit=structuredClone(s.units[E.unitKey(q)]);
  E.setLearned(b,s,'l2-01','lv',false);
  E.syncBatches(b,s,'2026-11-18');
  assert.equal(E.activePoints(b,s).length,5);
  assert.deepEqual(s.history,history);assert.deepEqual(s.units[E.unitKey(q)],unit);
  assert.deepEqual(s.paused,{});
});
test('RAZ and KET content can mix with Cambridge; invalid or unverified batch references fail',()=>{
  const {b,s}=dated(),q=b.questions[0];
  b.lessons.push({id:'test-raz',system:'raz',level:'D',number:1,title:'Test fixture',subtitle:'Test',source:'test fixture',status:'ready'});
  b.points.push({...b.points[0],id:'test-raz-point',lessonId:'test-raz',module:'reading'});
  b.questions.push({...q,id:'test-raz-question',pointId:'test-raz-point'});
  b.batches.push({id:'study-02',learnedOn:'2026-11-16',items:[{lessonId:'test-raz',modules:['reading']}]});
  E.validateBank(b);E.syncBatches(b,s,'2026-11-17');
  const ids=E.plan(b,s,{today:'2026-11-17',size:6,rng:()=>.5});
  assert(ids.includes('test-raz-question'));assert.equal(ids.length,6);
  b.batches.push({id:'bad',learnedOn:'2026-11-16',items:[{lessonId:'raz-d-country-places',modules:['reading']}]});
  assert.throws(()=>E.validateBank(b));
});
test('an overdue batch schedules one check; misses tomorrow and early practice does not extend dates',()=>{
  const {b,s}=dated(),q=b.questions[0];
  E.grade(b,s,q.id,q.answer,false,'2026-11-25');
  assert.equal(s.points[q.pointId].due,'2026-11-28');
  E.grade(b,s,q.id,q.answer,false,'2026-11-26');
  assert.equal(s.points[q.pointId].due,'2026-11-28');
  E.grade(b,s,q.id,(q.answer+1)%q.options.length,false,'2026-11-26');
  assert.equal(s.points[q.pointId].due,'2026-11-27');
});
test('malformed backups, invalid dates and ambiguous option arrays are rejected',()=>{
  const b=JSON.parse(JSON.stringify(bank));b.questions[0].answer=9;assert.throws(()=>E.validateBank(b));
  b.questions[0].answer=0;b.questions[0].options=['Monday','Monday'];assert.throws(()=>E.validateBank(b));
  const s=enrolled();s.points[bank.points[0].id].due='2026-02-30';assert.throws(()=>E.validateState(s,bank));
  assert.equal(E.plusDay('2026-12-31',1),'2027-01-01');
  assert.equal(E.validDay('2026-02-30'),false);
});
test('unspecified dates default to module generation day minus one and stay stable after publishing',()=>{
  const b=structuredClone(bank),s=E.emptyState();E.syncBatches(b,s,'2026-11-18');
  assert.equal(E.moduleDate(b,s,'l2-01','lv').date,'2026-11-15');
  assert.equal(s.points['l2-01-days'].due,'2026-11-16');
  b.updated='2026-12-12';E.syncBatches(b,s,'2026-12-12');
  assert.equal(E.moduleDate(b,s,'l2-01','lv').date,'2026-11-15');
});
test('date edits affect only selected module, survive syncing and backup validation',()=>{
  const {b,s}=dated();
  E.setModuleDate(b,s,'l2-01','lv','2026-11-17','2026-11-18');
  assert.equal(s.learningDates['l2-01-days'],'2026-11-17');
  assert.equal(s.learningDates['l2-01-frequency'],'2026-11-16');
  assert.equal(s.points['l2-01-days'].due,'2026-11-18');
  b.batches[0].learnedOn='2026-11-14';E.syncBatches(b,s,'2026-11-18');
  assert.equal(s.learningDates['l2-01-days'],'2026-11-17');
  assert.equal(E.validateState(structuredClone(s),b).moduleDates['l2-01--lv'],'2026-11-17');
});
test('future date edits exclude content until learning day and do not erase answered history',()=>{
  const {b,s}=dated(),q=b.questions[0];
  E.grade(b,s,q.id,q.answer,false,'2026-11-17');
  E.setModuleDate(b,s,'l2-01','lv','2026-12-01','2026-11-18');
  assert.equal(E.activePoints(b,s,'2026-11-18').length,3);
  assert.equal(s.history.length,1);
  assert.equal(s.points[q.pointId].due,'2026-12-02');
  assert.equal(E.duePoints(b,s,'2026-12-01').some(p=>p.module==='lv'),false);
});
test('local repeats append learning events without copying questions or resetting mastery',()=>{
  const {b,s}=dated(),q=b.questions[0],count=b.questions.length;
  E.grade(b,s,q.id,q.answer,false,'2026-11-17');
  E.addRepeat(b,s,'l2-01','lv','2026-11-18','2026-11-18');
  E.addRepeat(b,s,'l2-01','lv','2026-11-18','2026-11-18');
  assert.equal(s.localBatches.length,1);
  assert.equal(s.points[q.pointId].stage,1);
  assert.equal(b.questions.length,count);assert.equal(s.history.length,1);
  E.validateState(s,b);
  assert.throws(()=>E.addRepeat(b,s,'l2-01','lv','2026-11-19','2026-11-18'));
});
