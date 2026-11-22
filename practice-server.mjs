import P from './practice.js';
import E from './engine.js';
const encoder=new TextEncoder();
const sha=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function handlePractice(request,env){
  try{
    if(!env.LEARNING_DB||!env.LEARNING_ADMIN_TOKEN)fail(503,'Not configured');
    if(request.headers.get('authorization')!=='Bearer '+env.LEARNING_ADMIN_TOKEN)fail(401,'Unauthorized');
    const url=new URL(request.url),db=env.LEARNING_DB,route=url.pathname.split('/').at(-1);
    if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)fail(403,'Invalid origin');
    const accountId=request.method==='GET'?url.searchParams.get('accountId'):null;
    if(request.method==='GET'){
      // Reporting reads published snapshots from every account in this run.
      // It never changes the learner-only eligibility rules for generation.
      if(route==='report'){
        const runId=url.searchParams.get('runId');
        if(!/^[0-9a-f-]{36}$/.test(runId||''))fail(400,'Explicit report run required');
        const runs=(await db.prepare('SELECT account_id,receipt FROM account_practice_runs WHERE run_id=? ORDER BY account_id').bind(runId).all()).results;
        const publications=[];
        for(const run of runs){
          const receipt=JSON.parse(run.receipt);
          const rows=(await db.prepare('SELECT question_id,snapshot FROM account_practice_questions WHERE account_id=? AND run_id=?').bind(run.account_id,runId).all()).results;
          const questions=receipt.questionIds.map(id=>{
            const row=rows.find(q=>q.question_id===id);
            if(!row)fail(503,'Published snapshot unavailable');
            return JSON.parse(row.snapshot);
          });
          if(receipt.accountId!==run.account_id||receipt.runId!==runId||receipt.count!==questions.length||
            receipt.checksum!==await sha(JSON.stringify(questions)))fail(503,'Publication receipt mismatch');
          publications.push({receipt,questions});
        }
        return json({runId,publications});
      }
      if(accountId!=='ella')fail(400,'Explicit learner required');
      const account=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(accountId).first();
      if(!account?.bundle||account.kind!=='learner')fail(409,'Learner state unavailable');
      const ledger=(await db.prepare('SELECT * FROM account_practice_questions WHERE account_id=?').bind(accountId).all()).results;
      if(route==='source'){
        const catalog=await db.prepare('SELECT * FROM account_practice_variant_catalog WHERE account_id=?').bind(accountId).first();
        return json({account:{id:account.id,kind:account.kind},revision:account.revision,bundle:JSON.parse(account.bundle),ledger,
          variantRevision:catalog?.revision||0,variantReviews:catalog?JSON.parse(catalog.reviews):[]});
      }
      if(route==='publish'){
        const run=await db.prepare('SELECT receipt FROM account_practice_runs WHERE account_id=? AND run_id=?').bind(accountId,url.searchParams.get('runId')).first();
        if(!run)fail(404,'Receipt not found');
        const receipt=JSON.parse(run.receipt),bundle=JSON.parse(account.bundle);
        const questions=receipt.questionIds.map(id=>JSON.parse(ledger.find(q=>q.question_id===id&&q.run_id===receipt.runId).snapshot));
        return json({receipt,questions,visible:receipt.questionIds.every(id=>bundle.bank.questions.some(q=>q.id===id&&q.practiceFor===accountId)),revision:account.revision});
      }
      fail(404,'Not found');
    }
    if(request.method!=='POST'||!['publish','variants'].includes(route))fail(405,'Method not allowed');
    const text=await request.text();if(text.length>12000000)fail(413,'Too large');
    const data=JSON.parse(text);
    if(data.accountId!=='ella'||data.reviewed!==true)fail(400,'Reviewed learner publication required');
    if(route==='publish'&&(!/^[0-9a-f-]{36}$/.test(data.runId||'')||!Array.isArray(data.questions)||!data.questions.length))fail(400,'Reviewed learner publication required');
    const hash=await sha(text),prior=route==='publish'?await db.prepare('SELECT * FROM account_practice_runs WHERE account_id=? AND run_id=?').bind(data.accountId,data.runId).first():null;
    if(prior){if(prior.payload_hash!==hash)fail(409,'Retry payload changed');return json(JSON.parse(prior.receipt));}
    const account=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(data.accountId).first();
    if(!account?.bundle||account.kind!=='learner')fail(409,'Learner state unavailable');
    if(account.revision!==data.expectedRevision)fail(409,'Account changed; reselect');
    const bundle=JSON.parse(account.bundle),stateBefore=JSON.stringify(bundle.state);
    // Compare against the actual production bank, not caller-supplied source data.
    const response=await fetch(new URL('/question-bank.json',url),{headers:{'Cache-Control':'no-cache'}});
    if(!response.ok)fail(503,'Canonical bank unavailable');
    const bank=await response.json();
    if(JSON.stringify(bank)!==JSON.stringify(data.publicBank))fail(409,'Production bank changed');
    const ledger=(await db.prepare('SELECT * FROM account_practice_questions WHERE account_id=?').bind(data.accountId).all()).results;
    const fingerprints=Object.fromEntries(await Promise.all([...bank.questions,...bundle.bank.questions.filter(q=>q.practiceFor)].map(async q=>[q.id,await sha(P.identity(q))])));
    const catalog=await db.prepare('SELECT * FROM account_practice_variant_catalog WHERE account_id=?').bind(account.id).first();
    const variantRevision=catalog?.revision||0,variantReviews=catalog?JSON.parse(catalog.reviews):[];
    if(data.expectedVariantRevision!==variantRevision)fail(409,'Family reviews changed; reselect');
    if(route==='variants'){
      if(!Array.isArray(data.reviews)||!data.reviews.length)fail(400,'Family review required');
      const merged=new Map(variantReviews.map(r=>[r.questionId,r])),keys=E.targetKeys(bank),seen=new Set();
      for(const r of data.reviews){
        const q=bank.questions.find(q=>q.id===r.questionId&&q.active!==false&&!q.practiceFor)||
          bundle.bank.questions.find(q=>q.id===r.questionId&&q.practiceFor===account.id&&q.active!==false&&ledger.some(l=>l.question_id===q.id&&l.fingerprint===fingerprints[q.id]&&l.snapshot===JSON.stringify(q)));
        const base=q?.practiceFor?bank.questions.find(b=>b.id===q.baseQuestionId&&b.active!==false&&q.baseFingerprint===fingerprints[b.id]):q;
        if(!q||!base||r.fingerprint!==fingerprints[q.id]||seen.has(q.id)||
          !['reviewed','needs-material'].includes(r.status)||!/^[-a-zA-Z0-9_:]{1,120}$/.test(r.variantFamily||'')||
          typeof r.note!=='string'||!r.note.trim()||r.note.length>2000||!q.references?.length)fail(400,'Invalid fingerprint-bound family review');
        seen.add(q.id);
        merged.set(q.id,{questionId:q.id,fingerprint:fingerprints[q.id],targetKey:keys.get(base.id),unitKey:E.unitKey(q),
          variantFamily:r.variantFamily,status:r.status,note:r.note});
      }
      const reviews=[...merged.values()],serialized=JSON.stringify(reviews);
      const result=await db.prepare(`INSERT INTO account_practice_variant_catalog(account_id,revision,reviews)
        SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM accounts WHERE id=? AND revision=?)
        ON CONFLICT(account_id) DO UPDATE SET revision=revision+1,reviews=excluded.reviews
        WHERE revision=?`).bind(account.id,serialized,account.id,account.revision,variantRevision).run();
      if(!result.meta.changes)fail(409,'Source changed; reselect');
      return json({variantRevision:variantRevision+1,variantReviews:reviews,statePreserved:true});
    }
    const date=P.today(),selection=P.select({account:{id:account.id,kind:account.kind},revision:account.revision,bundle,fingerprints,variantRevision,variantReviews},bank,ledger,date);
    if(data.questions.length>selection.remaining)fail(400,'Daily limit');
    if(!Array.isArray(data.variantFamilies)||data.variantFamilies.length!==data.questions.length)fail(400,'Reviewed family sidecar required');
    const counts=new Map(),abilityCounts=new Map(),entries=[];
    for(const q of data.questions){
      const candidate=selection.candidates.find(c=>c.question.id===q.baseQuestionId);
      if(!candidate)fail(409,'Source no longer eligible');
      const base=candidate.question,key=candidate.targetKey;
      counts.set(key,(counts.get(key)||0)+1);if(counts.get(key)>P.policy.maxPerTarget)fail(400,'Target limit');
      const ability=JSON.stringify([key,candidate.unitKey]),family=data.variantFamilies.find(r=>r.questionId===q.id)?.variantFamily;
      abilityCounts.set(ability,(abilityCounts.get(ability)||0)+1);
      if(abilityCounts.get(ability)>candidate.neededVariants)fail(400,'Supply gap exceeded');
      if(!/^[-a-zA-Z0-9_:]{1,120}$/.test(family||'')||candidate.effectiveFamilies.includes(family)||
        entries.some(x=>x.key===key&&x.unitKey===candidate.unitKey&&x.family===family))fail(400,'Distinct reviewed family required');
      if(q.practiceFor!==account.id||q.pointId!==base.pointId||q.reviewUnit!==base.reviewUnit||q.learningTargetId!==candidate.learningTargetId||
        q.baseFingerprint!==await sha(P.identity(base))||q.active===false)fail(400,'Source identity mismatch');
      if(!q.references?.length||!q.references.every(r=>['original','excerpt','note','practice'].includes(r.kind)&&typeof r.text==='string'&&r.text.trim()&&typeof r.source==='string'&&r.source.trim())||
        typeof q.explanation!=='string'||!q.explanation.trim()||!q.references.some(r=>r.kind==='practice'))fail(400,'Reviewed references required');
      const allowed=['id','pointId','reviewUnit','type','prompt','options','answer','explanation','passage','audioText','source','references','practiceFor','baseQuestionId','baseFingerprint','learningTargetId'];
      if(Object.keys(q).some(k=>!allowed.includes(k)))fail(400,'Unexpected private metadata');
      if(q.type==='listening'&&!bank.questions.some(x=>x.audioText===q.audioText))fail(400,'Audio asset not verified');
      const content=JSON.stringify([q.baseQuestionId,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer]);
      const id='practice-'+(await sha(content)).slice(0,24);
      if(q.id!==id||bundle.bank.questions.some(x=>x.id===id)||entries.some(x=>x.q.id===id)||
        P.trivialVariant(q,base)||bundle.bank.questions.some(x=>E.unitKey(x)===candidate.unitKey&&
          (E.targetKeys(bundle.bank).get(x.id)===key)&&P.trivialVariant(q,x))||
        entries.some(x=>x.key===key&&x.unitKey===candidate.unitKey&&P.trivialVariant(q,x.q)))fail(400,'Duplicate or trivial variant');
      entries.push({q,fp:await sha(P.identity(q)),key,unitKey:candidate.unitKey,family});
    }
    bundle.bank=E.mergeBank(bundle.bank,bank);bundle.bank.practiceAccountId=account.id;
    for(const {q} of entries){
      bundle.bank.questions.push(q);
      const point=bank.points.find(p=>p.id===q.pointId),lesson=bundle.bank.lessons.find(l=>l.id===point.lessonId);
      lesson.learningTargets.find(t=>t.id===q.learningTargetId).questionIds.push(q.id);
    }
    E.validateBank(bundle.bank);
    if(JSON.stringify(bundle.state)!==stateBefore)fail(500,'State preservation failed');
    const receipt={runId:data.runId,accountId:account.id,count:entries.length,questionIds:entries.map(x=>x.q.id),
      checksum:await sha(JSON.stringify(entries.map(x=>x.q))),publishedAt:new Date().toISOString(),accountRevision:account.revision+1,bankRevision:bank.revision};
    const conditional='EXISTS(SELECT 1 FROM accounts WHERE id=? AND last_operation=?)';
    const statements=[db.prepare(`UPDATE accounts SET bundle=?,revision=revision+1,updated_at=?,last_operation=? WHERE id=? AND revision=?
      AND COALESCE((SELECT revision FROM account_practice_variant_catalog WHERE account_id=?),0)=?`)
      .bind(JSON.stringify(bundle),receipt.publishedAt,data.runId,account.id,account.revision,account.id,variantRevision)];
    for(const {q,fp,key} of entries){
      statements.push(db.prepare(`INSERT OR IGNORE INTO questions SELECT ?,?,?,? WHERE ${conditional}`)
        .bind(fp,q.id,bank.revision,JSON.stringify(q),account.id,data.runId));
      statements.push(db.prepare(`INSERT INTO account_practice_questions SELECT ?,?,?,?,?,?,? WHERE ${conditional}`)
        .bind(account.id,q.id,fp,data.runId,key,date,JSON.stringify(q),account.id,data.runId));
    }
    const reviews=[...variantReviews,...entries.map(x=>({questionId:x.q.id,fingerprint:x.fp,targetKey:x.key,unitKey:x.unitKey,
      variantFamily:x.family,status:'reviewed',note:'Reviewed at publication'}))];
    statements.push(db.prepare(`INSERT INTO account_practice_variant_catalog SELECT ?,1,? WHERE ${conditional}
      ON CONFLICT(account_id) DO UPDATE SET revision=revision+1,reviews=excluded.reviews`)
      .bind(account.id,JSON.stringify(reviews),account.id,data.runId));
    statements.push(db.prepare(`INSERT INTO account_practice_runs SELECT ?,?,?,? WHERE ${conditional}`).bind(account.id,data.runId,hash,JSON.stringify(receipt),account.id,data.runId));
    const results=await db.batch(statements);
    if(!results[0].meta.changes)fail(409,'Account changed; reselect');
    return json(receipt);
  }catch(error){return json({error:error.status?error.message:'Private publication unavailable'},error.status||503);}
}
