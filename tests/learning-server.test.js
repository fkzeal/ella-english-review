const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const {webcrypto}=require('node:crypto');
const Sync=require('../learning-sync');
const bank=require('../question-bank.json');
test('server persists isolated records, deduplicates retries and protects admin and approved sources',async()=>{
  const {handle,digest,questionIdentity}=await import('../learning-server.mjs');
  const mf=new Miniflare(convertV4MiniflareOptions({name:'learning',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['LEARNING_DB']}));
  try{
    const db=await mf.getD1Database('LEARNING_DB');
    for(const statement of fs.readFileSync('migrations/0001_learning.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
    const q=bank.questions[0],fingerprint=await digest(questionIdentity(q));
    await db.prepare('INSERT INTO questions VALUES(?,?,?,?)').bind(fingerprint,q.id,bank.revision,JSON.stringify(q)).run();
    const env={LEARNING_DB:db,LEARNING_ADMIN_TOKEN:'a'.repeat(64)},base='https://ella-english-review.pages.dev';
    async function call(path,{data,deviceId,token,origin=base}={}){
      const r=await handle(new Request(base+'/api/'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,
        ...(deviceId?{'X-Device-Id':deviceId}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})}),env);
      return {status:r.status,data:await r.json()};
    }
    const a=webcrypto.randomUUID(),b=webcrypto.randomUUID(),enrollment='b'.repeat(64);
    const registration=await call('register',{data:{deviceId:a,enrollment}});
    assert.equal(registration.status,200);
    assert.equal((await call('register',{data:{deviceId:a,enrollment}})).data.token,registration.data.token,'lost response can safely register again');
    assert.equal((await call('register',{data:{deviceId:a,enrollment:'c'.repeat(64)}})).status,409);
    const second=await call('register',{data:{deviceId:b,enrollment}});
    const e={eventId:webcrypto.randomUUID(),questionId:q.id,fingerprint,occurredAt:new Date().toISOString(),day:'2026-11-21',selected:(q.answer+1)%q.options.length,help:false,source:'live'};
    assert.equal((await call('events',{data:{events:[e]},deviceId:a,token:second.data.token})).status,401,'cannot impersonate another device');
    assert.equal((await call('events',{data:{events:[e]},deviceId:a,token:registration.data.token,origin:'https://evil.example'})).status,403);
    for(let i=0;i<2;i++)assert.equal((await call('events',{data:{events:[e]},deviceId:a,token:registration.data.token})).status,200);
    assert.equal((await call('events',{data:{events:[{...e,selected:q.answer}]},deviceId:a,token:registration.data.token})).status,409);
    assert.equal((await call('events',{data:{events:[{...e,eventId:webcrypto.randomUUID(),fingerprint:'0'.repeat(64)}]},deviceId:a,token:registration.data.token})).status,422);
    const stats=await call('device',{deviceId:a,token:registration.data.token});
    assert.equal(stats.data.answerCount,1);assert.equal(stats.data.wrongCount,1);
    assert.equal((await call('device',{deviceId:b,token:second.data.token})).data.answerCount,0);
    assert.equal((await call('admin/devices')).status,401);
    const admin=env.LEARNING_ADMIN_TOKEN;
    assert.equal((await call('admin/records?approvedOnly=true',{token:admin})).data.records.length,0);
    assert.equal((await call('admin/device',{token:admin,data:{deviceId:a,name:'QA',approved:true}})).status,200);
    await call('events',{deviceId:a,token:registration.data.token,data:{events:[{...e,eventId:webcrypto.randomUUID(),source:'imported'}]}});
    await call('events',{deviceId:a,token:registration.data.token,data:{events:[{...e,eventId:webcrypto.randomUUID(),source:'backfill'}]}});
    assert.equal((await call('admin/records?approvedOnly=true',{token:admin})).data.records.length,1,'imports/backfills do not pollute generation');
    const all=(await call('admin/records?deviceId='+a+'&limit=2',{token:admin})).data;
    assert.equal(all.records.length,2);assert.ok(all.nextCursor);
    assert.equal((await call('admin/records?deviceId='+a+'&cursor='+encodeURIComponent(all.nextCursor),{token:admin})).data.records.length,1);
    assert.equal((await call('admin/records?deviceId='+b,{token:admin})).data.records.length,0);
    assert.equal((await call('admin/records?deviceId='+a,{token:admin})).data.records.length,3,'history exists regardless of approval');
  }finally{await mf.dispose();}
});
test('client keeps a durable offline outbox and distinct installation identity; history backfill is explicit',async()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)};
  let offline=true,uploads=[],changes=0;
  const client=Sync.create({storage,crypto:webcrypto,enabled:true,onChange:()=>changes++,fetch:async(path,opts)=>{
    if(offline)throw new Error('offline');
    const body=opts.body?JSON.parse(opts.body):null;
    if(path==='/api/register')return new Response(JSON.stringify({token:'d'.repeat(64)}));
    if(path==='/api/events'){uploads.push(body.events);return new Response(JSON.stringify({acknowledged:body.events.map(e=>e.eventId),syncedAt:'2026-11-21T00:00:00Z'}));}
    return new Response(JSON.stringify({answerCount:1,wrongCount:1,approved:false}));
  }});
  const h={questionId:bank.questions[0].id,day:'2026-11-21',selected:1,help:false,correct:false};
  const legacy={...h},imported={...h,imported:true};
  const original=JSON.stringify(legacy);
  await client.prepare(h,bank.questions[0],bank.revision);const id=client.view().deviceId;
  await client.sync([h,legacy]);assert.equal(uploads.length,0);assert.equal(client.view([h]).pending,1);
  offline=false;await client.sync([h,legacy]);await client.sync([h,legacy]);
  assert.equal(uploads.length,1);assert.equal(client.view([h]).pending,0);assert.equal(JSON.stringify(legacy),original);
  assert.equal(uploads[0][0].source,'live');
  await client.backfill([legacy,imported],bank);
  assert.equal(legacy.recordSource,'backfill');assert.equal(imported.recordSource,'imported');
  assert.equal(client.view().deviceId,id);assert.ok(changes);
  const otherMap=new Map(),other=Sync.create({storage:{getItem:k=>otherMap.get(k)||null,setItem:(k,v)=>otherMap.set(k,v)},crypto:webcrypto,enabled:true,fetch:async()=>{}});
  await other.initialize();assert.notEqual(other.view().deviceId,id,'backups do not contain installation secrets');
  assert.equal(Sync.identity(bank.questions[0]),(await import('../learning-server.mjs')).questionIdentity(bank.questions[0]));
});
