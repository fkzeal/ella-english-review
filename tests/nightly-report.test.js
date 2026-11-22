'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {project,merge}=require('../scripts/update-nightly-report');
const bank=require('../question-bank.json');
function input(){
  return {runId:'test-run',date:'2026-11-21',createdAt:'2026-11-21T13:40:00Z',status:'framework',summary:'页面框架已就绪；下方展示既有题目，不计入本次新增。',sections:{
    materials:{value:'未执行',note:'本轮搭建框架。'},questions:{value:'0',note:'旧题仅作示例。'},
    fixes:{value:'0',note:'本次未改题。'},optimizations:{value:'0',note:'本次未调整。'},
    derivatives:{value:'未生成',note:'受控生成账本与定向分发尚未完成。'}
  },questions:[{id:'gt-veg-q01',change:'sample',reason:'页面示例。'}],todos:[]};
}
test('public report takes question text only from the shared bank and has precise target',()=>{
  const result=project(input(),bank);
  assert.equal(result.questions[0].prompt,bank.questions.find(q=>q.id==='gt-veg-q01').prompt);
  assert.equal(result.questions[0].target,'carrot / carrots：胡萝卜');
  assert.throws(()=>project({...input(),deviceId:'private'},bank),/Unsupported/);
  const body=input();body.questions[0].prompt='untrusted';assert.throws(()=>project(body,bank),/Unsupported/);
  const details=input();details.sections.derivatives.note='Ella answered incorrectly 4 times';assert.throws(()=>project(details,bank),/Private derivative/);
  assert.throws(()=>project({...input(),summary:'device 12345678-1234-1234-1234-123456789abc'},bank),/Private identifier/);
});
test('existing questions cannot be mislabeled as added and publication requires receipt',()=>{
  const body=input();body.status='published';body.questions[0].change='added';body.sections.questions.value='1';
  assert.throws(()=>project(body,bank,bank),/receipt/);
  body.verification={commit:'a'.repeat(40),actionsRun:'123',bankVerified:true};
  assert.throws(()=>project(body,bank,bank),/not new/);
  body.questions[0].change='optimized';body.sections.questions.value='0';body.sections.optimizations.value='1';
  assert.throws(()=>project(body,bank,bank),/must change/);
});
test('new shared question is recorded once after verified publication',()=>{
  const next=structuredClone(bank),q=structuredClone(next.questions[0]);q.id='daily-new-test';
  next.questions.push(q);next.lessons[0].learningTargets[0].questionIds.push(q.id);
  const body=input();body.status='published';body.questions=[{id:q.id,change:'added',reason:'补充同难度题。'}];body.sections.questions.value='1';
  body.verification={commit:'b'.repeat(40),actionsRun:'456',bankVerified:true};
  assert.equal(project(body,next,bank).questions[0].id,q.id);
  body.questions.push(body.questions[0]);assert.throws(()=>project(body,next,bank),/Duplicate/);
});
test('explanation repair may keep question ID, but changed answers may not',()=>{
  const next=structuredClone(bank),q=next.questions.find(q=>q.id==='gt-veg-q01');
  q.explanation+=' 这是已核对的词义。';
  const body=input();body.status='published';body.questions=[{id:q.id,change:'fixed',reason:'修正解析，保留题号与评价身份。'}];body.sections.fixes.value='1';
  body.verification={commit:'c'.repeat(40),actionsRun:'789',bankVerified:true};
  assert.equal(project(body,next,bank).questions[0].change,'fixed');
  q.answer=1;assert.throws(()=>project(body,next,bank),/new question identity/);
});
test('archive preserves history, run replay is idempotent, stale overwrite and corruption fail closed',()=>{
  const report=project(input(),bank);
  const archive=merge({version:1,reports:[]},report);
  assert.deepEqual(merge(archive,report),archive);
  const newer={...report,runId:'newer',createdAt:'2026-11-22T13:40:00Z',date:'2026-11-22'};
  const both=merge(archive,newer);assert.equal(both.reports[0].runId,'newer');assert.equal(both.reports.length,2);
  assert.throws(()=>merge(archive,{...report,createdAt:'2026-11-21T12:00:00Z'}),/stale/);
  assert.throws(()=>merge({version:1,reports:null},report),/never reset/);
});
test('empty successful run differs from failed branches; samples never inflate new counts',()=>{
  const body=input();body.status='no-change';body.questions=[];assert.equal(project(body,bank).status,'no-change');
  body.status='partial';body.sections.materials={value:'无法读取',note:'素材源读取失败，反馈分支继续。'};assert.equal(project(body,bank).sections.materials.value,'无法读取');
  const sample=input();sample.sections.questions.value='1';assert.throws(()=>project(sample,bank),/count mismatch/);
  sample.sections.questions.value='0';sample.date='2026-11-20';assert.throws(()=>project(sample,bank),/Shanghai/);
});
test('private publication reports only receipt count, never exports private verification or question bodies',()=>{
  const body=input();body.status='no-change';body.questions=[];
  body.sections.derivatives={value:'5',note:'私有巩固练习已核验；仅展示本轮发布数量。'};
  assert.throws(()=>project(body,bank),/receipt/);
  body.privateVerification={verified:true,count:5,runId:'private-run',checksum:'private'};
  const result=project(body,bank);
  assert.equal(result.sections.derivatives.value,'5');assert.equal(result.privateVerification,undefined);
  assert(!JSON.stringify(result).includes('private-run'));
  body.privateVerification.count=4;assert.throws(()=>project(body,bank),/receipt/);
});
test('published derivative details join the report without account metadata and match the count',()=>{
  const q={...structuredClone(bank.questions.find(q=>q.id==='l2-02-q04')),
    id:'practice-'+'a'.repeat(24),learningTargetId:'comic'};
  delete q.source;
  const body=input();body.status='no-change';body.questions=[];
  body.sections.derivatives={value:'1',note:'已发布衍生题的详情统一展示，不区分账号。'};
  body.privateVerification={verified:true,count:1,questions:[q]};
  const report=project(body,bank);
  assert.equal(report.questions.length,1);assert.equal(report.questions[0].change,'derived');
  assert.deepEqual(report.questions[0].options,q.options);
  assert.equal(report.questions[0].target,'read a comic：读漫画');
  assert.equal(report.privateVerification,undefined);
  q.practiceFor='ella';assert.throws(()=>project(body,bank),/Unsupported/);delete q.practiceFor;
  body.privateVerification.questions=[];assert.throws(()=>project(body,bank),/Complete/);
});
test('three same-target derivatives add zero main targets and new question IDs do not inflate coverage workload',()=>{
  const body=input();body.status='no-change';body.questions=[];
  body.sections.derivatives={value:'3',note:'已发布衍生题的详情统一展示，不区分账号。'};
  body.privateVerification={verified:true,count:3,questions:Array.from({length:3},(_,i)=>{
    const q={...structuredClone(bank.questions.find(q=>q.id==='l2-02-q04')),id:'practice-'+String(i).repeat(24),learningTargetId:'comic'};
    delete q.source;return q;
  })};
  assert.deepEqual(project(body,bank,bank).targetCounts,{newTargets:0,derivativeQuestions:3,derivativeNewTargets:0});
  const next=structuredClone(bank),q=structuredClone(next.questions[0]);q.id='same-target-new-question';
  next.questions.push(q);next.lessons[0].learningTargets[0].questionIds.push(q.id);
  assert.equal(project(input(),next,bank).targetCounts.newTargets,0);
});
