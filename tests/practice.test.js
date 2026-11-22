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
  assert.equal(P.select(src,bank,[],'2026-11-22').excluded.corrected,0,'one later original pass is not transfer evidence');
  src.bundle.state.history.push({...h,syncId:'later-2',selected:q.answer,correct:true,day:'2026-11-23'});
  assert.equal(P.select(src,bank,[],'2026-11-23').excluded.corrected,1);
  src.bundle.state.history.push({...h,syncId:'new-wrong',day:'2026-11-24'});
  assert.equal(P.select(src,bank,[],'2026-11-25').candidates.length,1,'a new mistake after a correction is eligible');
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
function review(src,q,family){
  (src.variantReviews ||= []).push({questionId:q.id,fingerprint:sha(P.identity(q)),targetKey:E.targetKeys(src.bundle.bank).get(q.id),
    unitKey:E.unitKey(q),status:'reviewed',variantFamily:family});
  src.fingerprints[q.id]=sha(P.identity(q));
}
function variant(src,family='transfer'){
  const base=src.bundle.bank.questions.find(q=>q.id==='l2-02-q04');
  const q={...structuredClone(base),id:'practice-fixture',prompt:'Which activity uses a story with drawings?',practiceFor:'ella',
    baseQuestionId:base.id,baseFingerprint:sha(P.identity(base)),learningTargetId:'comic'};
  src.bundle.bank.questions.push(q);src.bundle.bank.lessons.find(l=>l.id==='l2-02').learningTargets.find(t=>t.id==='comic').questionIds.push(q.id);
  review(src,base,'original:'+base.id);review(src,q,family);
  return {q,ledger:[{account_id:'ella',question_id:q.id,fingerprint:sha(P.identity(q)),target_key:'l2-02::comic',
    generated_day:'2026-11-10',snapshot:JSON.stringify(q)}]};
}
function response(src,q,d,correct=true,help=false,occurredAt){
  src.fingerprints[q.id]=sha(P.identity(q));
  src.bundle.state.history.push({questionId:q.id,selected:correct?q.answer:(q.answer+1)%q.options.length,correct,help,day:d,
    accountId:'ella',recordSource:'live',fingerprint:sha(P.identity(q)),...(occurredAt?{occurredAt}:{})});
}
test('same-day original correction, including known times, does not close expansion; help-correct is weakness',()=>{
  const src=source(),q=src.bundle.bank.questions.find(q=>q.id==='l2-02-q04');
  src.bundle.state.history[0].occurredAt='2026-11-21T01:00:00Z';
  response(src,q,'2026-11-21',true,false,'2026-11-21T02:00:00Z');
  assert.equal(P.select(src,bank,[],'2026-11-22').candidates[0].neededVariants,1);
  src.bundle.state.history=[];
  response(src,q,'2026-11-21',true,true);
  assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,1);
});
test('later first independent reviewed family pass pauses; a later same-day correction cannot masquerade as transfer',()=>{
  const src=source(),{q,ledger}=variant(src);
  response(src,q,'2026-11-22');
  assert.equal(P.select(src,bank,ledger,'2026-11-22').excluded.corrected,1);
  response(src,q,'2026-11-22',false);
  assert.equal(P.select(src,bank,ledger,'2026-11-22').excluded.corrected,0);
  assert.equal(P.select(src,bank,ledger,'2026-11-22').excluded.needsExplanation,1);
});
test('two reviewed families reuse, same-template IDs do not count twice, unused old variants wait',()=>{
  let src=source(),v=variant(src);
  assert.equal(P.select(src,bank,v.ledger,'2026-11-22').excluded.reuse,1);
  src=source();v=variant(src,'original:l2-02-q04');
  assert.equal(P.select(src,bank,v.ledger,'2026-11-22').decisions[0].effectiveFamilies.length,1);
  assert.equal(P.select(src,bank,v.ledger,'2026-11-22').excluded.reuse,1,'unused variant waits despite old mistake');
  response(src,v.q,'2026-11-21',false);
  assert.equal(P.select(src,bank,v.ledger,'2026-11-22').candidates[0].neededVariants,1);
});
test('different targets sharing an old unit neither cancel errors nor inflate supply',()=>{
  const src=source(),a=bank.questions.find(q=>q.id==='at-read-q02'),b=bank.questions.find(q=>q.id==='at-read-q03');
  assert(a&&b);assert.equal(E.unitKey(a),E.unitKey(b));assert.notEqual(E.targetKeys(bank).get(a.id),E.targetKeys(bank).get(b.id));
  src.bundle.state.history=[];response(src,b,'2026-11-20',false);response(src,a,'2026-11-21');
  assert.equal(P.select(src,bank,[],'2026-11-22').candidates[0].question.id,b.id);
});
test('target quota across abilities, target cooldown across batches, zero evidence and no state mutation',()=>{
  const src=source(),keys=E.targetKeys(bank),all=bank.questions.filter(q=>keys.get(q.id)==='l2-02::comic');
  const units=new Set();
  src.bundle.state.history=[];
  for(const q of all)if(!units.has(E.unitKey(q))){units.add(E.unitKey(q));response(src,q,'2026-11-21',false);}
  const before=JSON.stringify(src.bundle);
  const selected=P.select(src,bank,[],'2026-11-22');
  assert(selected.candidates.reduce((n,c)=>n+c.neededVariants,0)<=2);
  assert.equal(P.select(src,bank,[{target_key:'l2-02::comic',generated_day:'2026-11-21'}],'2026-11-22').candidates.length,0);
  assert.equal(JSON.stringify(src.bundle),before);
  src.bundle.state.history=[];
  assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,0);
  assert(P.coverage(src,bank,[],'2026-11-22').U>0,'unexamined targets do not produce derivatives');
});
test('private supply requires a real published ledger and exact evaluation fingerprints',()=>{
  const src=source(),{ledger}=variant(src);
  assert.equal(P.select(src,bank,[],'2026-11-22').candidates.length,1,'unpublished local ID is not supply');
  ledger[0].fingerprint='forged';
  assert.equal(P.select(src,bank,ledger,'2026-11-22').candidates.length,1);
});
test('new same-target variants preserve first screening and do not invent retest or mastery counts',()=>{
  const src=source(),before=P.coverage(src,bank,[],'2026-11-22'),{ledger}=variant(src);
  const after=P.coverage(src,bank,ledger,'2026-11-22');
  assert.deepEqual(after,before);assert.equal(after.R,null);assert.equal(after.stableMastery,null);assert.equal(after.sevenDayI,null);
});
test('option reorder and personal-name-only changes are not effective variants',()=>{
  const base={type:'choice',prompt:'Tom reads a comic. What does he read?',options:['a comic','a film','an email']};
  assert(P.trivialVariant({...base,prompt:'Alice reads a comic. What does he read?',options:[...base.options].reverse()},base));
  assert(!P.trivialVariant({...base,prompt:'Choose the activity that matches: 读漫画。'},base));
});
