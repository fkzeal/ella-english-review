(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine'),require('./practice-policy.json'));
})(typeof globalThis!=='undefined'?globalThis:this,function(E,policy){
  'use strict';
  const identity=q=>JSON.stringify([q.id,q.pointId,q.reviewUnit||null,q.learningTarget||null,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer,q.active!==false]);
  const time=h=>Date.parse(h.occurredAt||h.day+'T12:00:00Z');
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  function select(source,bank,ledger=[],date=today()){
    const today=date;
    E.validateBank(bank);
    if(source.account?.id!==policy.accountId||source.account.kind!=='learner'||source.bundle?.state.accountId!==policy.accountId)throw new Error('Verified learner source required');
    const current=new Map(bank.questions.filter(q=>q.active!==false&&!q.practiceFor).map(q=>[q.id,q]));
    const stored=new Map(source.bundle.bank.questions.map(q=>[q.id,q]));
    const targets=E.targetKeys(bank),accepted=[],excluded={invalid:0,corrected:0,reuse:0,cooldown:0,dailyLimit:0};
    const seen=new Set();
    for(const h of [...source.bundle.state.history].reverse().sort((a,b)=>time(b)-time(a))){
      const q=current.get(h.questionId),old=stored.get(h.questionId);
      if(!q||!old||identity(q)!==identity(old)||h.accountId!==policy.accountId||
        !['live','imported'].includes(h.recordSource)||h.qa===true||h.preview||
        (h.recordSource==='live'&&h.fingerprint!==source.fingerprints?.[q.id])||
        (h.recordSource==='imported'&&!policy.allowVerifiedImported)||
        h.correct!==(h.selected===q.answer)||!Number.isFinite(time(h))){excluded.invalid++;continue;}
      if(h.correct)continue;
      const key=E.unitKey(q),targetKey=targets.get(q.id);
      if(seen.has(key))continue;seen.add(key);
      const later=source.bundle.state.history.some(x=>{
        const other=current.get(x.questionId)||source.bundle.bank.questions.find(v=>v.id===x.questionId&&v.practiceFor===policy.accountId);
        return other&&E.unitKey(other)===key&&x.accountId===policy.accountId&&['live','imported'].includes(x.recordSource)&&
          !x.qa&&!x.preview&&(x.recordSource!=='live'||x.fingerprint===source.fingerprints?.[other.id])&&x.correct===true&&x.selected===other.answer&&!x.help&&time(x)>time(h);
      });
      if(later){excluded.corrected++;continue;}
      const variants=[...bank.questions,...source.bundle.bank.questions.filter(x=>x.practiceFor===policy.accountId)]
        .filter(x=>x.active!==false&&E.unitKey(x)===key);
      if(new Set(variants.map(x=>x.id)).size>=policy.minimumUnitVariants){excluded.reuse++;continue;}
      if(ledger.some(x=>x.target_key===targetKey&&x.generated_day<=today&&E.plusDay(x.generated_day,policy.cooldownDays)>today)){excluded.cooldown++;continue;}
      const lesson=bank.lessons.find(l=>l.learningTargets?.some(t=>t.questionIds.includes(q.id)));
      const target=lesson?.learningTargets.find(t=>t.questionIds.includes(q.id));
      if(!target){excluded.invalid++;continue;}
      accepted.push({question:q,lessonId:lesson.id,learningTargetId:target.id,targetKey,unitKey:key,sourceKinds:[h.recordSource]});
    }
    const remaining=Math.max(0,policy.maxPerDay-ledger.filter(x=>x.generated_day===today).length);
    excluded.dailyLimit=Math.max(0,accepted.length-remaining);
    return {accountId:policy.accountId,expectedRevision:source.revision,date:today,candidates:accepted.slice(0,remaining),excluded,remaining};
  }
  return {select,identity,policy,today};
});
