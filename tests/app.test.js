const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const E=require('../engine'),S=require('../storage'),A=require('../audio-player'),bank=require('../question-bank.json'),manifest=require('../audio/manifest.json');
function harness(initial,shared,overrides={}){
  const data=shared||new Map(initial===undefined?[]:[[S.KEY,initial]]);
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}});
    return nodes.get(id);
  }
  const nav=Object.assign(node('nav-library'),{dataset:{page:'library'},hasAttribute:()=>false});
  const win={ReviewEngine:E,ReviewStorage:S,ReviewAudio:A,setTimeout:()=>0,clearTimeout(){},LESSON_BANK:structuredClone(bank),LESSON_AUDIO:structuredClone(manifest),scrollTo(){},addEventListener(k,fn){this[k]=fn;},...overrides};
  const ctx={window:win,document:{getElementById:node,querySelectorAll:()=>[nav],querySelector:()=>node('brand'),addEventListener(){}},
    navigator:{locks:{request:async(k,fn)=>fn()}},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},
    location:{protocol:'file:',host:''},setTimeout:()=>0,clearTimeout(){},setInterval(fn){win.interval=fn;},console,URL,Blob,...overrides.context};
  vm.runInNewContext(fs.readFileSync(require.resolve('../app'),'utf8'),ctx);
  return {data,node,win,async ready(){await new Promise(resolve=>setImmediate(resolve));},
    async click(action,props={}){
      const el={dataset:{action,...props},closest:()=>el};
      await node('app').listeners.click({target:{closest:()=>el}});
    },
    async change(el){await node('app').listeners.change({target:el});},
    saved(){return JSON.parse(data.get(S.KEY));}};
}
test('app startup with invalid data renders recovery controls without overwriting data',async()=>{
  const raw=JSON.stringify({bank,state:{...E.emptyState(),settings:{size:999}}}),app=harness(raw);
  await app.ready();
  assert.equal(app.data.get(S.KEY),raw);
  await app.click('nav',{target:'library'});
  assert.match(app.node('app').innerHTML,/导出原始记录/);
  await app.click('start');
  assert.equal(app.data.get(S.KEY),raw);
});
test('cat encouragement follows saved correct answers and clears on the next question',async()=>{
  for(const assisted of [false,true]){
    const state=E.emptyState();E.syncBatches(bank,state);
    const qs=bank.questions.filter(q=>q.type==='choice').slice(0,2);
    state.session={items:qs.map(q=>q.id),index:0,results:[],day:E.day()};
    const app=harness(JSON.stringify({bank,state,baseline:JSON.stringify(bank)}));
    await app.ready();await app.click('resume');
    assert.doesNotMatch(app.node('app').innerHTML,/cat-cheer/);
    if(assisted)await app.change({id:'help-check',checked:true,dataset:{}});
    await app.click('select',{option:String(qs[0].answer)});
    assert.match(app.node('app').innerHTML,/cat-cheer/);
    assert.equal(app.saved().state.history.length,1);
    assert.equal(app.saved().state.history[0].help,assisted);
    if(assisted)assert.match(app.node('app').innerHTML,/这次借助了提示/);
    await app.click('next');
    assert.doesNotMatch(app.node('app').innerHTML,/cat-cheer|snow-confetti/);
    await app.click('select',{option:String((qs[1].answer+1)%qs[1].options.length)});
    assert.doesNotMatch(app.node('app').innerHTML,/cat-cheer|snow-confetti/);
    assert.match(app.node('app').innerHTML,/没关系/);
    assert.equal(app.saved().state.history.length,2);
  }
});
test('slow listening repeats neither reveal the transcript nor mark help, and leaving stops playback',async()=>{
  const state=E.emptyState();E.syncBatches(bank,state);
  const q=bank.questions.find(q=>q.type==='listening'),plays=[];let stops=0;
  state.session={items:[q.id],index:0,results:[],day:E.day()};
  const app=harness(JSON.stringify({bank,state,baseline:JSON.stringify(bank)}),undefined,{
    ReviewAudio:{...A,create:()=>({play:(text,options)=>plays.push({text,...options}),stop:()=>stops++,updateManifest(){}})}
  });
  await app.ready();await app.click('resume');
  assert.match(app.node('app').innerHTML,/慢速听/);
  await app.click('play',{id:q.id,speed:'slow'});
  assert.equal(plays[0].text,q.audioText);assert.equal(plays[0].slow,true);
  assert(!app.saved().state.session.hints?.[q.id]);
  assert.doesNotMatch(app.node('app').innerHTML,/已展开听力文本/);
  const count=stops;await app.click('pause');assert(stops>count);
});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function sessionRaw(qs){
  const state=E.emptyState();E.syncBatches(bank,state);
  state.session={items:qs.map(q=>q.id),index:0,results:[],hints:{},day:E.day()};
  return JSON.stringify({bank,state,baseline:JSON.stringify(bank)});
}
test('queued clicks on an old question are discarded after another tab advances the cursor',async()=>{
  const qs=bank.questions.filter(q=>q.type==='choice').slice(0,2);let gate;
  const app=harness(sessionRaw(qs),undefined,{context:{
    location:{protocol:'https:',href:'https://example.test/',host:'example.test'},AbortController,
    fetch:async()=>{if(gate)await gate.promise;return {ok:true,json:async()=>structuredClone(bank)};}
  }});
  await app.ready();const other=harness(undefined,app.data);await other.ready();
  await app.click('resume');await other.click('resume');
  gate=deferred();app.win.interval();await app.ready();
  const first=app.click('select',{option:String(qs[0].answer)}),second=app.click('select',{option:String(qs[0].answer)});
  await other.click('select',{option:String(qs[0].answer)});gate.resolve();
  await Promise.all([first,second]);
  assert.equal(app.saved().state.history.length,1);
  assert.equal(app.saved().state.session.index,1);
  await app.click('resume');await app.click('select',{option:String(qs[1].answer)});
  assert.equal(app.saved().state.history.length,2);
  assert.equal(app.saved().state.history[1].questionId,qs[1].id);
});
test('a pending answer save cannot overwrite a page navigation',async()=>{
  let gate;const locks={request:async(k,fn)=>{if(gate)await gate.promise;return fn();}};
  const q=bank.questions.find(q=>q.type==='choice'),app=harness(sessionRaw([q]),undefined,{context:{navigator:{locks}}});
  await app.ready();await app.click('resume');gate=deferred();
  const answer=app.click('select',{option:String(q.answer)});await app.ready();
  app.node('nav-library').listeners.click();assert.match(app.node('app').innerHTML,/PARENT/);
  gate.resolve();await answer;
  assert.match(app.node('app').innerHTML,/PARENT/);assert.equal(app.saved().state.history.length,1);
});
test('online bank updates refresh the audio manifest before exposing a new listening question',async()=>{
  const q=bank.questions.find(q=>q.type==='listening'),old=structuredClone(bank),oldAudio=structuredClone(manifest),media=[],requests=[];
  old.revision--;old.questions=old.questions.filter(x=>x.id!==q.id);
  for(const l of old.lessons)if(l.learningTargets)l.learningTargets=l.learningTargets.map(t=>({...t,questionIds:t.questionIds.filter(id=>id!==q.id)})).filter(t=>t.questionIds.length);
  delete oldAudio.clips[q.audioText];let published=false;
  const app=harness(undefined,undefined,{LESSON_BANK:old,LESSON_AUDIO:oldAudio,Audio:class{
    constructor(src){media.push(src);}play(){return Promise.resolve();}pause(){}removeAttribute(){}load(){}
  },context:{location:{protocol:'https:',href:'https://example.test/',host:'example.test'},AbortController,
    fetch:async url=>{requests.push(url.pathname);return {ok:true,json:async()=>structuredClone(url.pathname.includes('manifest')?manifest:published?bank:old)};}
  }});
  await app.ready();published=true;await app.click('refresh-bank');
  assert.equal(app.saved().bank.revision,bank.revision);assert(requests.includes('/audio-manifest.json'));
  const saved=app.saved();saved.state.session={items:[q.id],index:0,results:[],day:E.day()};
  app.data.set(S.KEY,JSON.stringify(saved));await app.click('resume');await app.click('resume');
  await app.click('play',{id:q.id});
  assert.equal(media.at(-1),manifest.clips[q.audioText].file);
});
test('missing new audio leaves the old online bank and learner history intact',async()=>{
  const state=E.emptyState();E.syncBatches(bank,state);
  const original=bank.questions.find(q=>q.type==='choice');E.grade(bank,state,original.id,original.answer);
  const incoming=structuredClone(bank);incoming.revision++;
  const q=incoming.questions.find(q=>q.type==='listening'),oldId=q.id;
  q.audioText='A newly published script.';q.id='new-listening-script';
  for(const l of incoming.lessons)for(const t of l.learningTargets||[])t.questionIds=t.questionIds.map(id=>id===oldId?q.id:id);
  const app=harness(JSON.stringify({bank,state,baseline:JSON.stringify(bank)}),undefined,{context:{
    location:{protocol:'https:',href:'https://example.test/',host:'example.test'},AbortController,
    fetch:async url=>({ok:true,json:async()=>structuredClone(url.pathname.includes('manifest')?manifest:incoming)})
  }});
  await app.ready();await app.click('refresh-bank');
  assert.equal(app.saved().bank.revision,bank.revision);assert.deepEqual(app.saved().state.history,state.history);
  assert.match(app.node('toast').textContent,/暂未同步/);
});
test('parent imports a real target patch, retires a whole course, and restores its valid historical backup',async()=>{
  const original=bank.questions.find(q=>q.id==='gt-veg-q01'),state=E.emptyState();E.syncBatches(bank,state);
  E.grade(bank,state,original.id,original.answer);
  const app=harness(JSON.stringify({bank,state,baseline:JSON.stringify(bank)}));await app.ready();
  app.node('confirm-dialog').showModal=()=>app.node('confirm-ok').onclick();
  app.node('confirm-dialog').close=()=>{};
  async function importFile(id,data){
    const text=JSON.stringify(data);await app.change({id,dataset:{},value:'update.json',files:[{size:Buffer.byteLength(text),text:async()=>text}]});
  }
  const lesson=structuredClone(bank.lessons.find(l=>l.id==='raz-d-greater-than'));
  const variant={...structuredClone(original),id:'gt-extra-choice',prompt:'Choose the word for carrots.'};
  lesson.learningTargets.find(t=>t.questionIds.includes(original.id)).questionIds.push(variant.id);
  await importFile('bank-file',{version:1,mode:'patch',revision:bank.revision+1,lessons:[lesson],points:[],questions:[variant]});
  assert.equal(app.saved().bank.questions.length,bank.questions.length+1);
  const snapshot=structuredClone(bank);snapshot.revision+=2;
  snapshot.lessons=snapshot.lessons.filter(l=>l.id!==lesson.id);
  snapshot.points=snapshot.points.filter(p=>p.lessonId!==lesson.id);
  snapshot.questions=snapshot.questions.filter(q=>snapshot.points.some(p=>p.id===q.pointId));
  await importFile('bank-file',snapshot);
  assert.deepEqual(app.saved().state.history,state.history);
  assert.equal(app.saved().bank.questions.find(q=>q.id===variant.id).active,false);
  await app.click('nav',{target:'courses'});
  assert.doesNotMatch(app.node('app').innerHTML,/Greater Than/);
  await app.click('nav',{target:'library'});
  assert.doesNotMatch(app.node('app').innerHTML,/class="section-label">RAZ D · Greater Than/);
  assert.match(app.node('app').innerHTML,/已停用/);
  const backup=app.saved();
  await importFile('state-file',{kind:'lesson-loop-backup',version:1,bank:backup.bank,state:backup.state});
  assert.deepEqual(app.saved().state.history,state.history);
  const reloaded=harness(undefined,app.data);await reloaded.ready();
  assert.deepEqual(reloaded.saved().state.history,state.history);
});
test('a deferred offline update without its audio retains a usable old bank and pending history',async()=>{
  const q=bank.questions.find(q=>q.type==='listening'),old=structuredClone(bank),oldAudio=structuredClone(manifest);
  old.revision--;old.questions=old.questions.filter(x=>x.id!==q.id);
  for(const l of old.lessons)if(l.learningTargets)l.learningTargets=l.learningTargets.map(t=>({...t,questionIds:t.questionIds.filter(id=>id!==q.id)})).filter(t=>t.questionIds.length);
  delete oldAudio.clips[q.audioText];
  const state=E.emptyState();E.syncBatches(old,state);
  const first=old.questions.find(q=>q.type==='choice');state.session={items:[first.id],index:0,results:[],day:E.day()};
  const app=harness(JSON.stringify({bank:old,state,baseline:JSON.stringify(old)}),undefined,{LESSON_AUDIO:oldAudio});
  await app.ready();await app.click('resume');await app.click('select',{option:String(first.answer)});
  await app.click('finish');await app.click('start');
  assert.equal(app.saved().bank.revision,old.revision);assert.equal(app.saved().state.history.length,1);
  assert(app.saved().state.session.items.length>0);
  assert.doesNotMatch(app.node('app').innerHTML,/记录未能保存/);
});
test('correct answers rotate six kittens, continuing after reload and skipping wrong answers',async()=>{
  const state=E.emptyState();E.syncBatches(bank,state);
  const qs=bank.questions.filter(q=>q.type==='choice').slice(0,8);
  state.session={items:qs.map(q=>q.id),index:0,results:[],day:E.day()};
  let app=harness(JSON.stringify({bank,state,baseline:JSON.stringify(bank)}));
  await app.ready();await app.click('resume');
  const cats=[];
  for(let i=0;i<qs.length;i++){
    if(i===3){await app.click('pause');app=harness(undefined,app.data);await app.ready();await app.click('resume');}
    await app.click('select',{option:String(i===2?(qs[i].answer+1)%qs[i].options.length:qs[i].answer)});
    const match=app.node('app').innerHTML.match(/data-kitten="([^"]+)"/);
    if(i===2)assert.equal(match,null);else cats.push(match[1]);
    await app.click('next');
  }
  assert.deepEqual(cats,['ginger','tuxedo','calico','gray','siamese','cream','ginger']);
  assert.equal(app.saved().state.history.length,8);
});
test('app transcript → pause → reload → resume → answer stays assisted',async()=>{
  const state=E.emptyState();E.syncBatches(bank,state);
  const q=bank.questions.find(q=>q.type==='listening');
  state.session={items:[q.id],index:0,results:[],day:E.day()};
  const raw=JSON.stringify({bank,state,baseline:JSON.stringify(bank)});
  const a=harness(raw);await a.ready();await a.click('resume');await a.click('transcript');await a.click('pause');
  assert.equal(a.saved().state.session.hints[q.id],true);
  const b=harness(undefined,a.data);await b.ready();await b.click('resume');
  assert.match(b.node('app').innerHTML,/已查看听力文本，本题计为使用提示/);
  assert.doesNotMatch(b.node('app').innerHTML,/id="help-check"/);
  await b.click('select',{option:String(q.answer)});
  assert.equal(b.saved().state.history.at(-1).help,true);
  assert.equal(b.saved().state.units[E.unitKey(q)].stage,0);
  assert.match(b.node('app').innerHTML,/这次借助了提示/);
});
test('manual parent help can be unchecked, remains cancelled after reload and grades independently',async()=>{
  const a=harness();await a.ready();await a.click('start');
  const q=bank.questions.find(q=>q.id===a.saved().state.session.items[0]);
  await a.change({id:'help-check',dataset:{},checked:true});
  assert.equal(a.saved().state.session.hints[q.id],true);
  await a.change({id:'help-check',dataset:{},checked:false});
  assert.equal(a.saved().state.session.hints[q.id],undefined);
  const b=harness(undefined,a.data);await b.ready();await b.click('resume');
  assert.doesNotMatch(b.node('app').innerHTML, /id="help-check" checked/);
  await b.click('select',{option:String(q.answer)});
  assert.equal(b.saved().state.history.at(-1).help,false);
});
test('manual help on a listening question never reveals the transcript on resume',async()=>{
  const state=E.emptyState();E.syncBatches(bank,state);
  const q=bank.questions.find(q=>q.type==='listening');
  state.session={items:[q.id],index:0,results:[],day:E.day(),hints:{[q.id]:true}};
  const a=harness(JSON.stringify({bank,state,baseline:JSON.stringify(bank)}));await a.ready();await a.click('resume');
  assert.match(a.node('app').innerHTML,/查看听力文本（计为使用提示）/);
  assert.doesNotMatch(a.node('app').innerHTML,/已展开听力文本/);
  await a.change({id:'help-check',dataset:{},checked:false});
  await a.click('select',{option:String(q.answer)});
  assert.equal(a.saved().state.history.at(-1).help,false);
});
test('app rejects a stale tab action and adopts the other tab answer without data loss',async()=>{
  const a=harness();await a.ready();
  const b=harness(undefined,a.data);await b.ready();
  await a.click('start');
  const q=bank.questions.find(q=>q.id===a.saved().state.session.items[0]);
  await a.click('select',{option:String(q.answer)});
  await b.change({id:'size',dataset:{},value:'10'});
  assert.equal(b.saved().state.history.length,1);assert.equal(b.saved().state.settings.size,6);
  await b.change({id:'size',dataset:{},value:'10'});
  assert.equal(b.saved().state.history.length,1);assert.equal(b.saved().state.settings.size,10);
});
test('local file applies a deferred bundled update after ending an old session',async()=>{
  const old=structuredClone(bank);old.revision=3;for(const q of old.questions)delete q.reviewUnit;
  const state=E.emptyState();E.syncBatches(old,state);
  state.session={items:[old.questions[0].id],index:0,results:[],day:E.day()};
  const a=harness(JSON.stringify({bank:old,state,baseline:JSON.stringify(old)}));await a.ready();
  assert.equal(a.saved().bank.revision,3);
  await a.click('resume');await a.click('select',{option:String(old.questions[0].answer)});await a.click('finish');
  // Starting another set must flush the bundled update even without fetch.
  await a.click('start');
  assert.equal(a.saved().bank.revision,bank.revision);
  assert.equal(a.saved().state.history.length,1);
});
test('legacy writer dropping metadata cannot hide a required bank migration',async()=>{
  const old=structuredClone(bank);delete old.revision;delete old.mode;
  const state=E.emptyState();E.syncBatches(old,state);
  const raw=JSON.stringify({bank:old,state,baseline:JSON.stringify(bank)});
  const app=harness(raw);await app.ready();
  assert.equal(app.saved().bank.revision,bank.revision);
  assert.equal(app.data.get(S.KEY+'-before-update'),raw);
});
test('course progress only edits initial dates and hides repeat and date provenance',async()=>{
  const app=harness();await app.ready();
  await app.click('nav',{target:'courses'});
  assert.match(app.node('app').innerHTML,/class="chip active" data-action="system" data-system="raz"/);
  await app.click('system',{system:'cambridge'});
  assert.match(app.node('app').innerHTML,/data-date-module="lv"/);
  assert.match(app.node('app').innerHTML,/data-date-module="rg"/);
  assert.match(app.node('app').innerHTML,/data-date-module="skills"/);
  assert.doesNotMatch(app.node('app').innerHTML,/type="checkbox"|手动暂停|勾选|记录复读|题库生成|家长已修改|来自发布/);
  assert.match(app.node('app').innerHTML,/首次学习日期/);
  await app.click('system',{system:'raz'});
  const html=app.node('app').innerHTML;
  const readyBooks=bank.lessons.filter(l=>l.system==='raz'&&l.status==='ready'&&
    bank.points.some(p=>p.lessonId===l.id&&bank.questions.some(q=>q.pointId===p.id&&q.active!==false)));
  assert.equal((html.match(/data-book-date=/g)||[]).length,readyBooks.length);
  assert.doesNotMatch(html,/type="checkbox"|data-book-lesson=|data-module=|data-date-module=|各模块独立|记录复读|题库生成|家长已修改|来自发布/);
  assert.match(html,/10 个学习目标/);
  assert.match(html,/12 个学习目标/);
  assert.doesNotMatch(html,/5 个考点/);
});
test('book date applies to all existing RAZ points without removing answers',async()=>{
  const lesson='raz-d-greater-than',state=E.emptyState();E.syncBatches(bank,state);
  const q=bank.questions.find(q=>q.pointId==='raz-d-greater-than-vegetables');
  E.grade(bank,state,q.id,q.answer,false,'2026-11-18');
  const app=harness(JSON.stringify({bank,state}));await app.ready();
  await app.change({dataset:{bookDate:lesson},value:'2026-11-16'});
  const saved=app.saved().state;
  for(const module of ['lv','rg','skills'])assert.equal(E.moduleDate(bank,saved,lesson,module).date,'2026-11-16');
  assert.deepEqual(saved.history,state.history);
  assert.deepEqual(saved.units[E.unitKey(q)],state.units[E.unitKey(q)]);
  assert.equal(E.activePoints(bank,app.saved().state).filter(p=>p.lessonId===lesson).length,5);
  assert.deepEqual(app.saved().state.history,state.history);
});
test('opening an old backup reenrolls unchecked books and modules but respects future dates',async()=>{
  const state=E.emptyState();E.syncBatches(bank,state);
  const q=bank.questions.find(q=>q.pointId==='raz-d-greater-than-vegetables');
  E.grade(bank,state,q.id,q.answer,false,'2026-11-18');
  E.setLearned(bank,state,'raz-d-greater-than','lv',false);
  E.setLearned(bank,state,'l2-01','rg',false);
  E.setModuleDate(bank,state,'raz-d-animal-tongues','skills',E.plusDay(E.day(),3));
  // Simulate an old client writing pause flags after its last reconciliation.
  E.setLearned(bank,state,'raz-d-greater-than','lv',false);
  E.setLearned(bank,state,'l2-01','rg',false);
  const app=harness(JSON.stringify({bank,state}));await app.ready();
  const saved=app.saved().state,active=E.activePoints(bank,saved);
  assert(active.some(p=>p.id===q.pointId));
  assert(active.some(p=>p.lessonId==='l2-01'&&p.module==='rg'));
  assert(!active.some(p=>p.lessonId==='raz-d-animal-tongues'&&p.module==='skills'));
  assert.deepEqual(saved.history,state.history);
  assert.deepEqual(saved.units[E.unitKey(q)],state.units[E.unitKey(q)]);
  assert.equal(saved.moduleDates['raz-d-animal-tongues--skills'],E.plusDay(E.day(),3));
  assert.deepEqual(saved.paused,{});
});
test('conflicting old RAZ dates do not partially save a unified book date',async()=>{
  const lesson='raz-d-greater-than',state=E.emptyState();E.syncBatches(bank,state);
  E.addRepeat(bank,state,lesson,'rg','2026-11-18','2026-11-18');
  const app=harness(JSON.stringify({bank,state}));await app.ready();
  const before=JSON.stringify(app.saved().state);
  await app.change({dataset:{bookDate:lesson},value:'2026-11-19'});
  assert.equal(JSON.stringify(app.saved().state),before);
});
