const {test}=require('node:test'),assert=require('node:assert/strict');
const E=require('../engine'),published=require('../question-bank.json'),S=require('../account-state');
const today='2026-11-22';
function fixture(n=30){
  const b={version:1,revision:1,updated:today,lessons:[{
    id:'lesson',level:2,number:1,title:'Coverage',subtitle:'',source:'controlled fixture',status:'ready',generatedOn:today,learningTargets:[]
  }],points:[{id:'point',lessonId:'lesson',module:'rg',title:'Targets',description:'Distinct targets',evidence:'fixture'}],questions:[]};
  for(let i=0;i<n;i++){
    const target={id:'target-'+i,title:'Target '+i,evidence:'fixture',questionIds:[]};
    for(let variant=0;variant<2;variant++){
      const q={id:`q-${i}-${variant}`,pointId:'point',reviewUnit:'unit-'+i,type:'choice',prompt:`Target ${i}, variant ${variant}`,
        options:['yes','no'],answer:0,explanation:'fixture',source:'fixture'};
      b.questions.push(q);target.questionIds.push(q.id);
    }
    b.lessons[0].learningTargets.push(target);
  }
  E.validateBank(b);const s=E.emptyState();E.syncBatches(b,s,today);return {b,s};
}
const plan=(b,s,extra={})=>E.coveragePlan(b,s,{today,rng:()=>.5,...extra});
function answerGroup(b,s,group,wrongIndex=-1){
  s.session={items:group.items,index:0,results:[],hints:{},day:today};
  for(const [i,id] of group.items.entries()){
    const q=b.questions.find(q=>q.id===id),r=E.grade(b,s,id,i===wrongIndex?1:q.answer,false,today);
    s.session.results.push(r);s.session.index++;
  }
}
test('ten is the default; consecutive all-correct groups cover twenty distinct targets without mutating plans',()=>{
  const {b,s}=fixture();assert.equal(s.settings.size,10);
  const before=structuredClone(s),first=plan(b,s);assert.deepEqual(s,before);
  assert.equal(first.items.length,10);assert(first.entries.every(x=>x.reason==='first'));
  answerGroup(b,s,first);
  assert.deepEqual(E.coverageSummary(b,s,today),{total:30,checked:10,unseen:20,weak:0,stable:0});
  const second=plan(b,s);assert(second.entries.every(x=>x.reason==='first'));
  assert.equal(new Set([...first.entries,...second.entries].map(x=>x.targetKey)).size,20);
  answerGroup(b,s,second);assert.equal(E.coverageSummary(b,s,today).checked,20);
  assert.equal(plan(b,s).entries.filter(x=>x.reason==='first').length,10);
});
test('an error completes first screening and is retested with an unused variant after other targets',()=>{
  const {b,s}=fixture(),first=plan(b,s);answerGroup(b,s,first,0);
  assert.equal(E.coverageSummary(b,s,today).checked,10);assert.equal(E.coverageSummary(b,s,today).weak,1);
  const key=first.entries[0].targetKey,second=plan(b,s),retest=second.entries.find(x=>x.targetKey===key);
  assert(retest);assert.equal(retest.reason,'reinforce');assert.notEqual(retest.questionId,first.items[0]);
  assert(second.entries.some(x=>x.reason==='first'));
  assert.equal(s.units[E.unitKey(b.questions.find(q=>q.id===first.items[0]))].due,E.plusDay(today,1));
});
test('a last-question error is placed only after at least four other targets in the next frozen group',()=>{
  const {b,s}=fixture(),first=plan(b,s);answerGroup(b,s,first,9);
  const second=plan(b,s),key=first.entries[9].targetKey;
  const index=second.entries.findIndex(x=>x.targetKey===key);
  assert(index>=4,index);assert.equal(second.entries[index].reason,'reinforce');
  assert.equal(new Set(second.entries.map(x=>x.targetKey)).size,10);
});
test('same-group retries, three same-day attempts and passed-today targets yield to first screening',()=>{
  const {b,s}=fixture(),first=plan(b,s);
  s.session={items:first.items,index:1,results:[],day:today};
  E.grade(b,s,first.items[0],1,false,today);
  assert(!plan(b,s).items.some(id=>E.unitKey(b.questions.find(q=>q.id===id))===E.unitKey(b.questions.find(q=>q.id===first.items[0]))));
  s.session=null;
  for(let i=0;i<2;i++)E.grade(b,s,first.items[0],1,false,today);
  for(const id of first.items.slice(1))E.grade(b,s,id,0,false,today);
  const next=plan(b,s);assert(next.entries.every(x=>x.reason==='first'));
});
test('due errors can get more than one slot from a single course without fixed course quotas',()=>{
  const {b,s}=fixture();
  for(const q of b.questions.filter(q=>q.id.endsWith('-0')).slice(0,8))E.grade(b,s,q.id,1,false,E.plusDay(today,-1));
  const group=plan(b,s);assert(group.entries.filter(x=>x.reason==='reinforce').length>=2);
  assert(group.entries.some(x=>x.reason==='first'));
});
test('long-overdue reviews get opportunities but cannot consume every slot while targets remain unseen',()=>{
  const {b,s}=fixture();
  for(const q of b.questions.filter(q=>q.id.endsWith('-0')).slice(0,20)){
    E.grade(b,s,q.id,0,false,'2026-10-01');s.units[E.unitKey(q)].due='2026-10-02';
  }
  E.syncUnits(b,s,today);const group=plan(b,s);
  assert(group.entries.some(x=>x.reason==='review'));assert(group.entries.some(x=>x.reason==='first'));
});
test('same-day extra correct answers do not erase distinct-day mastery; error or help does',()=>{
  const {b,s}=fixture(),id=b.questions[0].id,q=b.questions[0];
  for(const [i,date] of ['2026-11-01','2026-11-07','2026-11-15'].entries()){
    s.units[E.unitKey(q)].due=date;E.grade(b,s,i===1?b.questions[1].id:id,0,false,date);
  }
  const key=E.learningProfile(b,s,today).skillKey(q);
  assert(E.learningProfile(b,s,today).skills.get(key).stable);
  for(let i=0;i<6;i++)E.grade(b,s,id,0,false,today);
  assert(E.learningProfile(b,s,today).skills.get(key).stable);
  E.grade(b,s,id,0,true,today);assert(!E.learningProfile(b,s,today).skills.get(key).stable);
  E.grade(b,s,id,0,false,today);assert(!E.learningProfile(b,s,today).skills.get(key).stable);
});
test('shared legacy units do not infer mastery of an unseen target, and final groups deduplicate units and passages',()=>{
  const b=published,s=E.emptyState();E.syncBatches(b,s,today);
  for(const id of ['at-read-q02']){
    const q=b.questions.find(q=>q.id===id);
    for(const date of ['2026-11-01','2026-11-07','2026-11-15']){
      s.units[E.unitKey(q)].due=date;E.grade(b,s,id,q.answer,false,date);
    }
  }
  const p=E.learningProfile(b,s,today),q=b.questions.find(q=>q.id==='at-read-q03');
  assert(!p.skills.get(p.skillKey(q)).stable);assert(!p.targets.get(p.keys.get(q.id)).checked);
  const group=plan(b,s,{size:20}),questions=group.items.map(id=>b.questions.find(q=>q.id===id));
  assert.equal(new Set(questions.map(E.unitKey)).size,questions.length);
  const passages=questions.filter(q=>q.type==='reading').map(q=>q.passage);
  assert.equal(new Set(passages).size,passages.length);
});
test('a same-target new variant never creates a new uncovered target; new targets do',()=>{
  const {b,s}=fixture(),first=plan(b,s);answerGroup(b,s,first);
  const before=E.coverageSummary(b,s,today),q=b.questions.find(q=>q.id===first.items[0]);
  const incoming=structuredClone(b),variant={...q,id:'new-variant'};incoming.revision++;
  incoming.questions.push(variant);incoming.lessons[0].learningTargets.find(t=>t.questionIds.includes(q.id)).questionIds.push(variant.id);
  const merged=E.mergeBank(b,incoming);E.syncBatches(merged,s,today);
  assert.deepEqual(E.coverageSummary(merged,s,today),before);
  const expanded=structuredClone(merged);expanded.revision++;
  expanded.questions.push({...q,id:'new-target-question',reviewUnit:'new-unit'});
  expanded.lessons[0].learningTargets.push({id:'new-target',title:'New target',evidence:'fixture',questionIds:['new-target-question']});
  const next=E.mergeBank(merged,expanded);E.syncBatches(next,s,today);
  assert.equal(E.coverageSummary(next,s,today).unseen,before.unseen+1);
});
test('all screened targets remain available for voluntary warmup and future dates stay inactive',()=>{
  const {b,s}=fixture(5);
  for(const q of b.questions.filter(q=>q.id.endsWith('-0')))E.grade(b,s,q.id,0,false,today);
  const next=plan(b,s);assert.equal(next.items.length,5);assert(next.entries.every(x=>x.reason==='warmup'));
  E.setModuleDate(b,s,'lesson','rg',E.plusDay(today,3),today);
  assert.equal(plan(b,s).items.length,0);
});
test('coverage excludes QA and preview, deduplicates sync IDs and remains correct after an account merge',()=>{
  const {b,s}=fixture(),q=b.questions[0];
  s.history.push({questionId:q.id,pointId:q.pointId,selected:0,correct:true,help:false,day:today,qa:true});
  assert.equal(E.coverageSummary(b,s,today).checked,0);s.history=[];
  const base={bank:b,state:s,baseline:JSON.stringify(b)},a=structuredClone(base),c=structuredClone(base);
  for(const [bundle,id,syncId] of [[a,'q-0-0','answer-a'],[c,'q-1-0','answer-b']]){
    const r=E.grade(b,bundle.state,id,0,false,today);r.syncId=syncId;bundle.state.accountId='ella';r.accountId='ella';
  }
  const merged=S.merge(base,a,c,today);
  assert.equal(E.coverageSummary(merged.bank,merged.state,today).checked,2);
  merged.state.history.push({...merged.state.history[0]});
  assert.equal(E.learningProfile(merged.bank,merged.state,today).attempts.length,2);
});
