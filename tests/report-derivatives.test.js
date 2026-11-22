const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createHash,randomUUID}=require('node:crypto');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
const bank=require('../question-bank.json');
const sha=x=>createHash('sha256').update(x).digest('hex');
function publication(account,run,id='a'){
  const q={...structuredClone(bank.questions.find(q=>q.id==='l2-02-q04')),id:'practice-'+id.repeat(24),
    practiceFor:account,baseQuestionId:'l2-02-q04',baseFingerprint:'private',learningTargetId:'comic'};
  return {receipt:{runId:run,accountId:account,count:1,questionIds:[q.id],checksum:sha(JSON.stringify([q]))},questions:[q]};
}
test('report readback aggregates every account, strips identity and deduplicates identical questions',async()=>{
  const {verifyDerivativePublications}=await import('../scripts/report-derivatives.mjs');
  const run=randomUUID(),ella=publication('ella',run),dad=publication('dad',run,'b');
  const verified=verifyDerivativePublications({runId:run,publications:[ella,dad]},run);
  assert.equal(verified.count,2);
  assert(!JSON.stringify(verified).includes('practiceFor'));
  assert(!JSON.stringify(verified).includes('baseFingerprint'));
  const same=publication('dad',run);
  assert.equal(verifyDerivativePublications({runId:run,publications:[ella,same]},run).count,1);
  same.questions[0].answer=2;
  assert.throws(()=>verifyDerivativePublications({runId:run,publications:[same]},run),/checksum/);
  same.receipt.checksum=sha(JSON.stringify(same.questions));
  assert.throws(()=>verifyDerivativePublications({runId:run,publications:[ella,same]},run),/Conflicting/);
  assert.throws(()=>verifyDerivativePublications({runId:run,publications:[ella,ella]},run),/receipt/);
  assert.throws(()=>verifyDerivativePublications({runId:randomUUID(),publications:[]},run),/unavailable/);
});
test('admin report query includes other accounts for this run and rejects incomplete evidence',async()=>{
  const {handlePractice}=await import('../practice-server.mjs');
  const {verifyDerivativePublications}=await import('../scripts/report-derivatives.mjs');
  const mf=new Miniflare(convertV4MiniflareOptions({name:'derivative-report',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['LEARNING_DB']}));
  const db=await mf.getD1Database('LEARNING_DB'),secret='test-only'.repeat(8),run=randomUUID();
  try{
    for(const file of fs.readdirSync('migrations').filter(f=>f.endsWith('.sql')).sort())
      for(const statement of fs.readFileSync('migrations/'+file,'utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
    for(const [account,id] of [['ella','a'],['dad','b']]){
      await db.prepare('INSERT INTO accounts(id,name,kind,code_hash) VALUES(?,?,?,?)').bind(account,account,account==='ella'?'learner':'parent','test-hash').run();
      const p=publication(account,run,id),q=p.questions[0];
      await db.prepare('INSERT INTO account_practice_runs VALUES(?,?,?,?)').bind(account,run,'test',JSON.stringify(p.receipt)).run();
      await db.prepare('INSERT INTO account_practice_questions VALUES(?,?,?,?,?,?,?)').bind(account,q.id,'test',run,'test','2026-11-22',JSON.stringify(q)).run();
    }
    const call=async(suffix='',auth=secret)=>handlePractice(new Request('https://ella-english-review.pages.dev/api/admin/practice/report'+suffix,{headers:{Authorization:'Bearer '+auth}}),{LEARNING_DB:db,LEARNING_ADMIN_TOKEN:secret});
    assert.equal((await call('?runId='+run,'wrong')).status,401);
    assert.equal((await call()).status,400);
    const response=await call('?runId='+run);assert.equal(response.status,200);
    assert.equal(verifyDerivativePublications(await response.json(),run).count,2);
    const empty=randomUUID();
    assert.equal(verifyDerivativePublications(await (await call('?runId='+empty)).json(),empty).count,0);
    await db.prepare('DELETE FROM account_practice_questions WHERE account_id=?').bind('dad').run();
    assert.equal((await call('?runId='+run)).status,503);
  }finally{await mf.dispose();}
});
