const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const E=require('../engine'),S=require('../storage'),bank=require('../question-bank.json');
function harness(initial,shared){
  const data=shared||new Map(initial===undefined?[]:[[S.KEY,initial]]);
  const nodes=new Map();
  function node(id){
    if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;}});
    return nodes.get(id);
  }
  const win={ReviewEngine:E,ReviewStorage:S,LESSON_BANK:structuredClone(bank),scrollTo(){},addEventListener(k,fn){this[k]=fn;}};
  const ctx={window:win,document:{getElementById:node,querySelectorAll:()=>[],querySelector:()=>node('brand'),addEventListener(){}},
    navigator:{locks:{request:async(k,fn)=>fn()}},localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},
    location:{protocol:'file:',host:''},setTimeout:()=>0,clearTimeout(){},setInterval(){},console,URL,Blob};
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
