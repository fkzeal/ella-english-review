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
  async function migrate(){
    for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())
      for(const statement of fs.readFileSync('migrations/'+file,'utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  await migrate();
  await db.batch(await Promise.all(bank.questions.map(async q=>db.prepare('INSERT INTO questions VALUES(?,?,?,?)').bind(await digest(questionIdentity(q)),q.id,bank.revision,JSON.stringify(q)))));
  for(const a of await accountSeeds(secret))await db.prepare('INSERT INTO accounts(id,name,kind,code_hash) VALUES(?,?,?,?)').bind(a.id,a.name,a.kind,a.codeHash).run();
  const base='https://ella-english-review.pages.dev',env={LEARNING_DB:db,LEARNING_ADMIN_TOKEN:secret};
  async function call(path,data,auth,origin=base){
    const r=await handle(new Request(base+'/api/'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,
      ...(auth?{Authorization:'Bearer '+auth.token,'X-Device-Id':auth.deviceId}:{})},...(data?{body:JSON.stringify(data)}:{})}),env);
    return {status:r.status,data:await r.json()};
  }
  async function login(id='ella'){
    const deviceId=crypto.randomUUID(),r=await call('accounts/login',{accountId:id,code:await accountCode(secret,id),deviceId,initialize:true});
    assert.equal(r.status,200);return {deviceId,token:r.data.token};
  }
  return {mf,db,call,login,secret,accountCode,migrate};
}
test('private account inspection lists active bindings and state without credentials or other accounts',async()=>{
  const h=await serverHarness();
  try{
    const a=await h.login(),b=await h.login(),other=await h.login('test-1');
    const bundle=await normalized();answer(bundle,bank.questions[0].id);
    await h.call('accounts/state',{operationId:crypto.randomUUID(),revision:0,bundle,migrate:true},a);
    await h.db.prepare('UPDATE account_sessions SET expires_at=? WHERE device_id=?').bind('2020-01-01T00:00:00Z',b.deviceId).run();
    const route='admin/account-inspect?accountId=ella',admin={token:h.secret};
    assert.equal((await h.call(route)).status,401);
    assert.equal((await h.call(route,null,other)).status,401);
    assert.equal((await h.call('admin/account-inspect',null,admin)).status,400);
    assert.equal((await h.call(route,{},admin)).status,405);
    const result=await h.call(route,null,admin);
    assert.equal(result.status,200);assert.equal(result.data.account.id,'ella');
    assert.equal(result.data.state.history.length,1);
    assert.equal(result.data.bankRevision,bank.revision);
    assert.equal(result.data.bundle,undefined);
    assert.deepEqual(result.data.devices.map(d=>d.deviceId),[a.deviceId]);
    assert(!JSON.stringify(result.data).includes(a.token));
    assert(!JSON.stringify(result.data).includes('password_hash'));
    assert(!JSON.stringify(result.data).includes(other.deviceId));
  }finally{await h.mf.dispose();}
});
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
    await a.client.login('ella',code,{initialize:true});
    assert.equal(a.get().state.history.length,1);assert.equal(a.get().state.history[0].recordSource,'imported');
    a.offline(true);
    const q=bank.questions[1],r=E.grade(bank,a.get().state,q.id,q.answer,false,'2026-11-21');
    await a.client.prepare(r,q);
    assert.equal(await a.client.sync(),false);assert.equal(a.get().state.history.length,2);
    a.offline(false);assert.equal(await a.client.sync(),true);assert.equal(await a.client.sync(),true);
    const b=client();await b.client.login('ella',code,{importLocal:false});
    assert.equal(b.get().state.history.length,2);
    await b.client.login('test-1',await h.accountCode(h.secret,'test-1'),{initialize:true});
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
test('first device sets a password; other devices verify it and logout never reopens initialization',async()=>{
  const h=await serverHarness();
  try{
    const status=()=>h.call('accounts/status');
    assert.equal((await status()).data.accounts.find(a=>a.id==='dad').needsSetup,true);
    const body={accountId:'dad',code:'739',deviceId:crypto.randomUUID()};
    assert.equal((await h.call('accounts/login',body)).status,409,'old cached clients cannot silently initialize');
    assert.equal((await h.call('accounts/login',{...body,initialize:true},null,'https://bad.example')).status,403);
    assert.equal((await h.call('accounts/login',{...body,code:' ',initialize:true})).status,400);
    assert.equal((await h.call('accounts/login',{...body,deviceId:'invalid',initialize:true})).status,401);
    assert.equal((await status()).data.accounts.find(a=>a.id==='dad').needsSetup,true);
    const first=await h.call('accounts/login',{...body,initialize:true});
    assert.equal(first.status,200);
    const credential=await h.db.prepare('SELECT * FROM account_credentials WHERE account_id=?').bind('dad').first();
    assert.match(credential.password_hash,/^pbkdf2-sha256\$100000\$/);
    assert.equal((await status()).data.accounts.find(a=>a.id==='dad').needsSetup,false);
    assert.equal((await h.call('accounts/login',{...body,code:'other',deviceId:crypto.randomUUID(),initialize:true})).status,401);
    const second=await h.call('accounts/login',{...body,deviceId:crypto.randomUUID()});
    assert.equal(second.status,200);
    assert.notEqual(first.data.token,second.data.token);
    await h.call('accounts/logout',{}, {token:first.data.token,deviceId:body.deviceId});
    await h.db.prepare('DELETE FROM account_sessions WHERE account_id=?').bind('dad').run();
    await h.migrate();
    assert.equal((await status()).data.accounts.find(a=>a.id==='dad').needsSetup,false);
    assert.equal((await h.call('accounts/login',{...body,code:'reset-attempt',initialize:true})).status,401);
    assert.equal((await h.call('accounts/login',body)).status,200);
    assert.equal((await h.call('admin/account-code',{accountId:'dad'},{token:h.secret})).status,409);
    assert.equal((await h.call('admin/account-code',{accountId:'mom'},{token:h.secret})).status,409);
  }finally{await h.mf.dispose();}
});
test('simultaneous first bindings pick one password atomically and preserve it after repeated deployments',async()=>{
  const h=await serverHarness();
  try{
    const bodies=['739','different'].map(code=>({accountId:'mom',code,deviceId:crypto.randomUUID(),initialize:true}));
    const results=await Promise.all(bodies.map(b=>h.call('accounts/login',b)));
    assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM account_sessions WHERE account_id=?').bind('mom').first()).n,1);
    const winner=bodies[results.findIndex(r=>r.status===200)];
    await h.migrate();await h.migrate();
    assert.equal((await h.call('accounts/login',{...winner,deviceId:crypto.randomUUID()})).status,200,'lost response can retry with same password');
    assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM account_credentials WHERE account_id=?').bind('mom').first()).n,1);
  }finally{await h.mf.dispose();}
});
test('first binding transaction rolls back password claim if creating the device session fails',async()=>{
  const h=await serverHarness();
  try{
    await h.db.prepare("CREATE TRIGGER reject_session BEFORE INSERT ON account_sessions BEGIN SELECT RAISE(ABORT, 'fixture failure'); END").run();
    const body={accountId:'dad',code:'739',deviceId:crypto.randomUUID(),initialize:true};
    assert.equal((await h.call('accounts/login',body)).status,503);
    assert.equal(await h.db.prepare('SELECT * FROM account_credentials WHERE account_id=?').bind('dad').first(),null);
    await h.db.prepare('DROP TRIGGER reject_session').run();
    assert.equal((await h.call('accounts/login',body)).status,200);
  }finally{await h.mf.dispose();}
});
test('legacy migration protects bound accounts, saved records and expired sessions but releases unused preset codes',async()=>{
  const h=await serverHarness();
  try{
    const {digest}=await import('../learning-server.mjs');
    for(const id of ['ella','dad','mom']){
      await h.db.prepare('UPDATE accounts SET code_hash=? WHERE id=?').bind(await digest(await h.accountCode(h.secret,id)),id).run();
    }
    const legacyToken='fixture-legacy-session',deviceId=crypto.randomUUID();
    await h.db.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?)').bind(await digest(legacyToken),'ella',deviceId,'2026-01-01','2099-01-01').run();
    await h.db.prepare('UPDATE accounts SET bundle=?,revision=1 WHERE id=?').bind(JSON.stringify(await normalized()),'dad').run();
    await h.migrate();
    const status=(await h.call('accounts/status')).data.accounts;
    assert.equal(status.find(a=>a.id==='ella').needsSetup,false);
    assert.equal(status.find(a=>a.id==='dad').needsSetup,false,'saved data never becomes claimable after logout');
    assert.equal(status.find(a=>a.id==='mom').needsSetup,true,'unused preset is not a password');
    assert.equal((await h.call('accounts/state',null,{token:legacyToken,deviceId})).status,200);
    assert.equal((await h.call('accounts/login',{accountId:'ella',code:'739',deviceId:crypto.randomUUID(),initialize:true})).status,401);
    assert.equal((await h.call('accounts/login',{accountId:'ella',code:await h.accountCode(h.secret,'ella'),deviceId:crypto.randomUUID()})).status,200);
    assert.equal((await h.call('admin/account-code',{accountId:'ella'},{token:h.secret})).status,200);
    const before=(await h.db.prepare('SELECT bundle FROM accounts WHERE id=?').bind('dad').first()).bundle;
    await h.db.prepare('DELETE FROM account_sessions WHERE account_id=?').bind('ella').run();
    await h.migrate();
    assert.equal((await h.call('accounts/status')).data.accounts.find(a=>a.id==='ella').needsSetup,false);
    assert.equal((await h.db.prepare('SELECT bundle FROM accounts WHERE id=?').bind('dad').first()).bundle,before);
    // A 0.7.0 request may finish after migrations but before the new worker activates.
    await h.db.prepare('INSERT INTO account_sessions VALUES(?,?,?,?,?)').bind('expired-legacy','mom',crypto.randomUUID(),'2020-01-01','2020-02-01').run();
    assert.equal((await h.call('accounts/status')).data.accounts.find(a=>a.id==='mom').needsSetup,false);
  }finally{await h.mf.dispose();}
});
