const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {webcrypto:crypto}=require('node:crypto');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const E=require('../engine'),R=require('../rewards'),S=require('../account-state'),Sync=require('../account-sync'),bank=require('../question-bank.json');
const copy=S.copy;
function fresh(){const state=E.emptyState();E.syncBatches(bank,state,'2026-11-21');return {bank:copy(bank),state,baseline:JSON.stringify(bank)};}
async function normalized(bundle=fresh()){return S.normalize(bundle,{accountId:'ella',deviceId:crypto.randomUUID(),crypto,migrate:true});}
function answer(bundle,id,selected,day='2026-11-21'){
  const q=bundle.bank.questions.find(q=>q.id===id),h=E.grade(bundle.bank,bundle.state,id,selected??q.answer,false,day);
  h.syncId='test-'+crypto.randomUUID();h.accountId='ella';h.recordSource='imported';return h;
}
test('account merge deduplicates migration, combines devices, retains pending sessions and survives old backups',async()=>{
  const original=fresh();answer(original,bank.questions[0].id);
  delete original.state.history[0].syncId;delete original.state.history[0].accountId;
  const a=await normalized(original),b=await normalized(original);
  assert.equal(S.merge(null,a,b).state.history.length,1);
  assert.equal(a.state.history[0].recordSource,'imported');
  const base=await normalized(),left=copy(base),right=copy(base);
  answer(left,bank.questions[0].id);answer(right,bank.questions[1].id);
  const merged=S.merge(base,left,right);
  assert.equal(merged.state.history.length,2);E.validateState(merged.state,merged.bank);
  const items=bank.questions.slice(0,6).map(q=>q.id);
  left.state.session={rewardId:'session-a',items,index:0,results:[],hints:{},day:'2026-11-21'};
  right.state.session={rewardId:'session-b',items,index:0,results:[],hints:{},day:'2026-11-21'};
  const sessions=S.merge(base,left,right);
  assert.equal(sessions.state.session.rewardId,'session-a');assert.ok(sessions.state.accountSessions['session-b']);
  const changed=copy(base);changed.state.settings.size=10;
  const changedAgain=copy(base);changedAgain.state.settings.size=15;
  assert.throws(()=>S.merge(base,changed,changedAgain),/两个设备/);
});
test('merging the same practice rejects divergent answers rather than silently losing work',async()=>{
  const base=await normalized(),left=copy(base),right=copy(base),q=bank.questions[0];
  const template={rewardId:'same-session',items:[q.id],index:0,results:[],hints:{},day:'2026-11-21'};
  base.state.session=copy(template);left.state.session=copy(template);right.state.session=copy(template);
  left.state.session.results.push(answer(left,q.id,q.answer));left.state.session.index=1;
  right.state.session.results.push(answer(right,q.id,(q.answer+1)%q.options.length));right.state.session.index=1;
  assert.throws(()=>S.merge(base,left,right),/不同答案/);
});
test('merged schedules retain both devices mistakes and cannot mark a missed unit mastered',async()=>{
  const base=await normalized(),left=copy(base),right=copy(base),q=bank.questions.find(q=>q.reviewUnit);
  answer(left,q.id,q.answer,'2026-11-21');
  answer(right,q.id,(q.answer+1)%q.options.length,'2026-11-21');
  const merged=S.merge(base,left,right,'2026-11-21'),unit=merged.state.units[E.unitKey(q)];
  assert.equal(merged.state.history.length,2);assert.equal(unit.stage,0);assert.equal(unit.due,'2026-11-22');assert.equal(unit.errors,1);
});
async function serverHarness(){
  const {handle,digest,questionIdentity}=await import('../learning-server.mjs');
  const {accountSeeds,accountCode}=await import('../account-server.mjs');
  const mf=new Miniflare(convertV4MiniflareOptions({name:'accounts',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['LEARNING_DB']}));
  const db=await mf.getD1Database('LEARNING_DB'),secret='a'.repeat(64);
  for(const file of ['0001_learning.sql','0002_accounts.sql'])for(const statement of fs.readFileSync('migrations/'+file,'utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  await db.batch(await Promise.all(bank.questions.map(async q=>db.prepare('INSERT INTO questions VALUES(?,?,?,?)').bind(await digest(questionIdentity(q)),q.id,bank.revision,JSON.stringify(q)))));
  for(const a of await accountSeeds(secret))await db.prepare('INSERT INTO accounts(id,name,kind,code_hash) VALUES(?,?,?,?)').bind(a.id,a.name,a.kind,a.codeHash).run();
  const base='https://ella-english-review.pages.dev',env={LEARNING_DB:db,LEARNING_ADMIN_TOKEN:secret};
  async function call(path,data,auth,origin=base){
    const r=await handle(new Request(base+'/api/'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,
      ...(auth?{Authorization:'Bearer '+auth.token,'X-Device-Id':auth.deviceId}:{})},...(data?{body:JSON.stringify(data)}:{})}),env);
    return {status:r.status,data:await r.json()};
  }
  async function login(id='ella'){
    const deviceId=crypto.randomUUID(),r=await call('accounts/login',{accountId:id,code:await accountCode(secret,id),deviceId});
    assert.equal(r.status,200);return {deviceId,token:r.data.token};
  }
  return {mf,db,call,login,secret,accountCode};
}
test('cloud accounts isolate data, authenticate, enforce compare-and-swap, and settle chest operations once',async()=>{
  const h=await serverHarness();
  try{
    const a=await h.login(),b=await h.login(),test=await h.login('test-1');
    assert.equal((await h.call('accounts/state')).status,401);
    assert.equal((await h.call('accounts/state',null,{...a,deviceId:test.deviceId})).status,401);
    const bundle=await normalized();
    bundle.state.rewards={version:1,balance:6,settlements:[0,1,2].map(i=>({id:'earned-'+i,correct:6,total:6,units:2,day:'2026-11-21'})),openings:[]};
    const body={operationId:crypto.randomUUID(),revision:0,bundle,migrate:true};
    assert.equal((await h.call('accounts/state',body,a,'https://bad.example')).status,403);
    assert.equal((await h.call('accounts/state',body,a)).status,200);
    assert.equal((await h.call('accounts/state',body,a)).data.revision,1,'lost response retry is idempotent');
    assert.equal((await h.call('accounts/state',{...body,operationId:crypto.randomUUID()},b)).status,409);
    assert.equal((await h.call('accounts/state',null,test)).data.bundle,null);
    const open={operationId:crypto.randomUUID(),revision:1};
    const draw=await h.call('accounts/open',open,a);assert.equal(draw.status,200);
    assert.equal(draw.data.bundle.state.rewards.balance,0);
    assert.equal((await h.call('accounts/open',open,a)).data.result.catId,draw.data.result.catId);
    assert.equal((await h.call('accounts/open',{operationId:crypto.randomUUID(),revision:1},b)).status,409);
    assert.equal((await h.call('accounts/open',{operationId:crypto.randomUUID(),revision:2},b)).status,409);
    assert.equal((await h.call('admin/accounts')).status,401);
    assert.equal((await h.call('accounts/logout',{},a)).status,200);
    assert.equal((await h.call('accounts/state',null,a)).status,401);
  }finally{await h.mf.dispose();}
});
test('client migrates once, uploads offline work, restores on a fresh device and never mixes accounts',async()=>{
  const h=await serverHarness();
  try{
    function client(initial=fresh()){
      const map=new Map();let bundle=copy(initial),offline=false,loseOpen=false;
      const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
      const client=Sync.create({storage,crypto,enabled:true,getBundle:()=>bundle,applyBundle:async b=>{bundle=copy(b);},fetch:async(url,opts)=>{
        if(offline)throw new Error('offline');
        const data=opts.body?JSON.parse(opts.body):null;
        const auth=opts.headers.Authorization?{token:opts.headers.Authorization.slice(7),deviceId:opts.headers['X-Device-Id']}:null;
        const r=await h.call(url.replace('/api/',''),data,auth);
        if(loseOpen&&url.endsWith('/open')){loseOpen=false;throw new Error('response lost');}
        return new Response(JSON.stringify(r.data),{status:r.status});
      }});
      return {client,get:()=>bundle,offline:value=>{offline=value;},loseNextOpen:()=>{loseOpen=true;},map};
    }
    const old=fresh();answer(old,bank.questions[0].id);delete old.state.history[0].accountId;
    old.state.rewards={version:1,balance:6,settlements:[0,1,2].map(i=>({id:'legacy-earned-'+i,total:6,correct:6,units:2,day:'2026-11-21'})),openings:[]};
    const a=client(old),code=await h.accountCode(h.secret,'ella');
    await a.client.login('ella',code);
    assert.equal(a.get().state.history.length,1);assert.equal(a.get().state.history[0].recordSource,'imported');
    a.offline(true);
    const q=bank.questions[1],r=E.grade(bank,a.get().state,q.id,q.answer,false,'2026-11-21');
    await a.client.prepare(r,q);
    assert.equal(await a.client.sync(),false);assert.equal(a.get().state.history.length,2);
    a.offline(false);assert.equal(await a.client.sync(),true);assert.equal(await a.client.sync(),true);
    const b=client();await b.client.login('ella',code,{importLocal:false});
    assert.equal(b.get().state.history.length,2);
    await b.client.login('test-1',await h.accountCode(h.secret,'test-1'));
    assert.equal(b.get().state.history.length,0);assert.equal(b.get().state.accountId,'test-1');
    await b.client.login('ella',code);assert.equal(b.get().state.history.length,2);
    a.get().state.settings.size=10;
    b.get().state.settings.size=15;
    assert.equal(await a.client.sync(),true);
    assert.equal(await b.client.sync(),false);
    assert.match(b.client.view().error,/两个设备/);
    await b.client.resolve();
    assert.equal(b.get().state.settings.size,10);
    assert.equal(b.client.localBackup().state.settings.size,15,'conflict original is exportable');
    const before=copy(b.get());
    await b.client.importBundle(before);
    assert.equal(b.get().state.history.length,2,'restoring own backup does not duplicate attempts');
    await assert.rejects(()=>b.client.importBundle({...before,state:{...before.state,accountId:'dad'}}),/另一个账号/);
    a.loseNextOpen();
    await assert.rejects(()=>a.client.open(),/response lost/);
    assert.equal(a.get().state.rewards.openings.length,0);
    assert.equal(await a.client.sync(),true,'recover acknowledged-but-unseen chest');
    assert.equal(a.get().state.rewards.openings.length,1);
    assert.equal(a.get().state.rewards.balance,0);
    assert.equal(await a.client.sync(),true);
    assert.equal(a.get().state.rewards.openings.length,1,'retry cannot draw twice');
    assert.equal(await b.client.sync(),true);
    assert.equal(b.get().state.rewards.openings[0].catId,a.get().state.rewards.openings[0].catId);
    const approved=await h.call('admin/account-records?accountId=ella&generation=true',null,{token:h.secret});
    assert.equal(approved.data.records.length,1,'migration excluded from generation');
    const excluded=await h.call('admin/account-records?accountId=test-1&generation=true',null,{token:h.secret});
    assert.equal(excluded.data.records.length,0);
  }finally{await h.mf.dispose();}
});
