const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const {randomUUID,createHash}=require('node:crypto');
test('maintenance state requires admin and origin; lease fencing and revision CAS preserve the previous snapshot',async()=>{
  const {handle}=await import('../learning-server.mjs');
  const mf=new Miniflare(convertV4MiniflareOptions({name:'maintenance',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['LEARNING_DB']}));
  try{
    const db=await mf.getD1Database('LEARNING_DB');
    for(const sql of fs.readFileSync('migrations/0005_maintenance.sql','utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
    const env={LEARNING_DB:db,LEARNING_ADMIN_TOKEN:'a'.repeat(64)},base='https://ella-english-review.pages.dev',owner=randomUUID(),other=randomUUID();
    async function call(route,data,token=env.LEARNING_ADMIN_TOKEN,origin=base){
      const r=await handle(new Request(base+'/api/admin/maintenance/'+route,{method:data?'POST':'GET',
        headers:{Authorization:'Bearer '+token,Origin:origin,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})}),env);
      return {status:r.status,data:await r.json()};
    }
    assert.equal((await call('state',null,'wrong')).status,401);
    assert.equal((await call('lease',{owner},env.LEARNING_ADMIN_TOKEN,'https://evil.test')).status,403);
    assert.equal((await call('lease',{owner})).status,200);
    assert.equal((await call('lease',{owner:other})).status,409);
    const revision=randomUUID(),manifest={version:1,chunks:2,bytes:8,sha256:'a'.repeat(64)};
    assert.equal((await call('chunk',{owner:other,revision,part:0,content:'YQ=='})).status,409);
    assert.equal((await call('chunk',{owner,revision,part:0,content:'YQ=='})).status,200);
    assert.equal((await call('commit',{owner,revision,expected:null,manifest})).status,409,'incomplete upload cannot replace state');
    assert.equal((await call('state')).data.revision,null);
    assert.equal((await call('chunk',{owner,revision,part:1,content:'Yg=='})).status,200);
    assert.equal((await call('commit',{owner,revision,expected:null,manifest})).status,200);
    assert.equal((await call('chunk',{owner,revision,part:0,content:'Yw=='})).status,409,'published chunks are immutable');
    const second=randomUUID();
    await call('chunk',{owner,revision:second,part:0,content:'YQ=='});
    assert.equal((await call('commit',{owner,revision:second,expected:null,manifest:{...manifest,chunks:1}})).status,409,'stale writers cannot overwrite newer state');
    await db.prepare('UPDATE maintenance_head SET lease_until=0 WHERE id=1').run();
    await call('lease',{owner:other});
    assert.equal((await call('chunk',{owner,revision:second,part:1,content:'Yg=='})).status,409,'expired owners are fenced');
    assert.equal((await call('state')).data.revision,revision);
    const runId=randomUUID();
    await call('receipt',{runId,status:'PASS'});
    await call('receipt',{runId,status:'rewritten'});
    assert.equal((await call('receipt?run='+runId)).data.status,'PASS');
  }finally{await mf.dispose();}
});
test('private archive authenticates all bytes and restores only allowed files without replacing existing state',async()=>{
  const {pack,encrypt,decrypt,unpack}=await import('../scripts/cloud-state.mjs');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ella-state-test-')),token='a'.repeat(64);
  try{
    const source=path.join(dir,'source');fs.mkdirSync(path.join(source,'.course-imports/media'),{recursive:true});
    fs.mkdirSync(path.join(source,'.error-feedback'));fs.mkdirSync(path.join(source,'handoff'));
    const image=Buffer.from('original-image'),hash=createHash('sha256').update(image).digest('hex');
    fs.writeFileSync(path.join(source,'.course-imports/media/image.jpg'),image);
    fs.writeFileSync(path.join(source,'.course-imports/ledger.json'),JSON.stringify({version:1,
      documentUrl:'https://dcar.feishu.cn/docx/RhNgdppuWoKp6kxjE24cOwjfnwh',media:{image:{status:'published',localPath:'/old/media/image.jpg',sha256:hash}}}));
    for(const name of ['.error-feedback/scan.json','path-map.json','local-task-disabled.confirmed','handoff/Ella-22点30自动化任务-云端交接.md'])
      fs.writeFileSync(path.join(source,name),'{}');
    fs.writeFileSync(path.join(source,'env.sh'),'SECRET-MUST-NOT-ENTER-ARCHIVE');
    const archive=pack(source),encrypted=encrypt(archive,token);
    assert.ok(!JSON.stringify(archive).includes('env.sh'));assert.ok(!encrypted.includes('original-image'));
    assert.throws(()=>decrypt(encrypted,'b'.repeat(64)));
    const damaged=Buffer.from(encrypted,'base64');damaged[40]^=1;
    assert.throws(()=>decrypt(damaged.toString('base64'),token));
    const restored=decrypt(encrypted,token),destination=path.join(dir,'restored');
    unpack(restored,destination);
    assert.deepEqual(fs.readFileSync(path.join(destination,'.course-imports/media/image.jpg')),image);
    assert.equal(fs.statSync(path.join(destination,'path-map.json')).mode&0o777,0o600);
    assert.throws(()=>unpack(restored,destination));
    assert.throws(()=>unpack({...restored,files:[...restored.files,{path:'../escape',data:'',sha256:createHash('sha256').update('').digest('hex')}]},path.join(dir,'unsafe')));
    fs.rmSync(path.join(source,'.course-imports/media/image.jpg'));
    assert.throws(()=>pack(source),'missing published evidence must not become a new empty baseline');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
