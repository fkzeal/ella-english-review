const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const P=require('../practice'),E=require('../engine'),S=require('../account-state'),bank=require('../question-bank.json');
const sha=x=>createHash('sha256').update(x).digest('hex');
function source(){
  const b=structuredClone(bank),state=E.emptyState();E.syncBatches(b,state,'2026-11-21');state.accountId='ella';
  const q=b.questions.find(q=>q.id==='l2-02-q04');
  state.history.push({questionId:q.id,pointId:q.pointId,selected:1,correct:false,help:false,day:'2026-11-21',syncId:'fixture',recordSource:'live',accountId:'ella',fingerprint:sha(P.identity(q))});
  return {account:{id:'ella',kind:'learner'},revision:1,bundle:{bank:b,state},fingerprints:{[q.id]:sha(P.identity(q))}};
}
test('selector admits verified live and imported learner records, excludes tests, invalid fingerprints and corrected units',()=>{
  const src=source();assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,1);
  const h=src.bundle.state.history[0];h.fingerprint='invalid';assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,0);
  h.recordSource='imported';assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,1);
  h.qa=true;assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,0);delete h.qa;
  assert.throws(()=>P.select({...src,account:{id:'test-1',kind:'test'}},bank),/learner/);
  const q=src.bundle.bank.questions.find(q=>q.id===h.questionId);
  src.bundle.state.history.push({...h,syncId:'later',selected:q.answer,correct:true,day:'2026-11-22'});
  assert.equal(P.select(src,bank,[],'2026-11-22').excluded.corrected,1);
  src.bundle.state.history.push({...h,syncId:'new-wrong',day:'2026-11-23'});
  assert.equal(P.select(src,bank,[],'2026-11-24').candidates.length,1,'a new mistake after a correction is eligible');
});
test('selector respects retired identities, cooldown and daily cap',()=>{
  const src=source(),key='l2-02::comic';
  assert.equal(P.select(src,bank,[{target_key:key,generated_day:'2026-11-21'}],'2026-11-22').excluded.cooldown,1);
  assert.equal(P.select(src,bank,Array.from({length:6},()=>({target_key:'other',generated_day:'2026-11-22'})),'2026-11-22').candidates.length,0);
  src.bundle.bank.questions.find(q=>q.id==='l2-02-q04').answer=2;
  assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,0);
});
test('private bank refresh and same-revision account merge preserve questions and target limits without changing learning dates',()=>{
  const src=source(),b=src.bundle.bank,q={...structuredClone(b.questions.find(q=>q.id==='l2-02-q04')),id:'practice-fixture',practiceFor:'ella',baseQuestionId:'l2-02-q04',learningTargetId:'comic',prompt:'原创练习'};
  b.practiceAccountId='ella';b.questions.push(q);b.lessons.find(l=>l.id==='l2-02').learningTargets.find(t=>t.id==='comic').questionIds.push(q.id);
  const merged=E.mergeBank(b,structuredClone(bank));
  assert.notEqual(merged.questions.find(x=>x.id===q.id).active,false);
  assert.equal(E.targetKeys(merged).get(q.id),'l2-02::comic');
  const local=structuredClone(src.bundle);local.bank=structuredClone(bank);
  const before=JSON.stringify(src.bundle.state.moduleDates);
  const result=S.merge(local,local,src.bundle,'2026-11-22');
  assert(result.bank.questions.some(x=>x.id===q.id&&x.active!==false));
  assert.equal(JSON.stringify(result.state.moduleDates),before);
  assert.equal(E.dueUnits(result.bank,result.state,'2026-11-22').length,E.dueUnits(bank,result.state,'2026-11-22').length);
});
