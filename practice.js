(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./engine'),require('./practice-policy.json'));
})(typeof globalThis!=='undefined'?globalThis:this,function(E,policy){
  'use strict';
  // Evaluation identity is deliberately unchanged; family reviews live outside questions.
  const identity=q=>JSON.stringify([q.id,q.pointId,q.reviewUnit||null,q.learningTarget||null,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer,q.active!==false]);
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const day=h=>/^\d{4}-\d{2}-\d{2}$/.test(h.day||'')&&Number.isFinite(Date.parse(h.day))?h.day:null;
  const weak=h=>h.correct===false||h.help===true;
  const independent=h=>h.correct===true&&h.help===false;
  const sentenceWords=new Set(['What','Which','Who','Where','When','Why','How','The','A','An','I','We','You','He','She','It','They','This','That','These','Those','Is','Are','Am','Do','Does','Did','Can','Must','For','In','On','At','There','Let']);
  const normalized=text=>String(text||'').replace(/\b[A-Z][a-z]+\b/g,w=>sentenceWords.has(w)?w:'{name}').replace(/\s+/g,' ').trim();
  const template=q=>JSON.stringify([q.type,normalized(q.prompt),normalized(q.passage),normalized(q.audioText),q.options.map(normalized).sort()]);
  const trivialVariant=(q,base)=>template(q)===template(base);
  function evidence(source,bank,ledger,date){
    E.validateBank(bank);
    if(source.account?.id!==policy.accountId||source.account.kind!=='learner'||source.bundle?.state.accountId!==policy.accountId)throw new Error('Verified learner source required');
    const current=new Map(bank.questions.filter(q=>q.active!==false&&!q.practiceFor).map(q=>[q.id,q]));
    const stored=new Map(source.bundle.bank.questions.map(q=>[q.id,q])),targets=E.targetKeys(bank),invalidQuestions=new Set();
    for(const row of ledger){
      let q;try{q=JSON.parse(row.snapshot);}catch{continue;}
      const base=current.get(q.baseQuestionId),old=stored.get(q.id);
      if(row.account_id===policy.accountId&&q.practiceFor===policy.accountId&&q.active!==false&&base&&old&&
        row.question_id===q.id&&identity(old)===identity(q)&&q.baseFingerprint===source.fingerprints?.[base.id]&&
        row.fingerprint===source.fingerprints?.[q.id]&&q.pointId===base.pointId&&E.unitKey(q)===E.unitKey(base)&&
        row.target_key===targets.get(base.id)&&q.learningTargetId===row.target_key.split('::').slice(1).join('::')){
        current.set(q.id,q);targets.set(q.id,targets.get(base.id));
      }
    }
    const rows=[];let invalid=0;
    for(const h of source.bundle.state.history){
      const q=current.get(h.questionId),old=stored.get(h.questionId),d=day(h);
      if(!q||!old||identity(q)!==identity(old)||h.accountId!==policy.accountId||
        !['live','imported'].includes(h.recordSource)||h.qa===true||h.preview||h.test===true||
        (h.recordSource==='live'&&h.fingerprint!==source.fingerprints?.[q.id])||
        (h.recordSource==='imported'&&!policy.allowVerifiedImported)||
        h.correct!==(h.selected===q.answer)||!d||d>date){invalid++;invalidQuestions.add(h.questionId);continue;}
      rows.push({...h,day:d,targetKey:targets.get(q.id),unitKey:E.unitKey(q)});
    }
    return {current,targets,rows,invalid,invalidQuestions};
  }
  function select(source,bank,ledger=[],date=today()){
    const {current,targets,rows,invalid}=evidence(source,bank,ledger,date);
    const excluded={invalid,corrected:0,reuse:0,needsExplanation:0,needsFamilyReview:0,needsMaterial:0,cooldown:0,dailyLimit:0,targetLimit:0};
    const groups=new Map(),decisions=[],accepted=[];
    for(const h of rows){
      const key=JSON.stringify([h.targetKey,h.unitKey]);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(h);
    }
    for(const history of groups.values()){
      const failures=history.filter(weak);if(!failures.length)continue;
      failures.sort((a,b)=>b.day.localeCompare(a.day));
      const latest=failures[0],targetKey=latest.targetKey,unitKey=latest.unitKey;
      const questions=[...current.values()].filter(q=>targets.get(q.id)===targetKey&&E.unitKey(q)===unitKey);
      const originals=questions.filter(q=>!q.practiceFor);
      const family=new Map(),reviews=source.variantReviews||[];
      let needsReview=false,needsMaterial=false;
      for(const q of questions){
        const review=reviews.find(r=>r.questionId===q.id&&r.fingerprint===source.fingerprints?.[q.id]&&r.targetKey===targetKey&&r.unitKey===unitKey);
        if(review?.status==='needs-material'){needsMaterial=true;continue;}
        if(review?.status==='reviewed'&&review.variantFamily)family.set(q.id,review.variantFamily);
        else if(originals.length===1&&!q.practiceFor)family.set(q.id,'original:'+q.id);
        else needsReview=true;
      }
      const families=[...new Set(family.values())],weakFamilies=new Set(failures.filter(h=>h.day===latest.day).map(h=>family.get(h.questionId)));
      // A known first attempt may pass even if a later attempt failed, but the latter
      // starts a new problem. With unknown order, a family/day containing help or a
      // wrong response cannot establish an independent first pass.
      const passedDays=new Set();let transferred=false;
      const later=history.filter(h=>h.day>latest.day);
      for(const d of new Set(later.map(h=>h.day))){
        for(const f of families){
          const attempts=later.filter(h=>h.day===d&&family.get(h.questionId)===f);
          if(!attempts.length)continue;
          const timed=attempts.every(h=>h.recordSource==='live'&&Number.isFinite(Date.parse(h.occurredAt)))&&
            new Set(attempts.map(h=>h.occurredAt)).size===attempts.length;
          const first=timed?[...attempts].sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt))[0]:null;
          const passed=first?independent(first):attempts.every(independent);
          if(!passed)continue;
          if(!weakFamilies.has(f))transferred=true;
          if(questions.length===1&&attempts[0].questionId===originals[0]?.id)passedDays.add(d);
        }
      }
      const errorDays=new Set(failures.filter(h=>!h.correct).map(h=>h.day)).size;
      const helpDays=new Set(failures.filter(h=>h.help).map(h=>h.day)).size;
      const decision={targetKey,unitKey,baseQuestionId:originals.find(q=>q.id===latest.questionId)?.id||originals[0]?.id,
        sourceKinds:[...new Set(failures.map(h=>h.recordSource))],
        latestWeakDay:latest.day,errorDays,helpDays,effectiveFamilies:families,questionIds:questions.map(q=>q.id),
        weakEvidence:failures.map(h=>({questionId:h.questionId,day:h.day,correct:h.correct,help:h.help===true,recordSource:h.recordSource,fingerprint:h.fingerprint||null}))};
      decision.baseFingerprint=source.fingerprints?.[decision.baseQuestionId];
      let reason;
      if(needsMaterial||!originals.length)reason='needsMaterial';
      else if((!needsReview&&transferred)||passedDays.size>=2){reason='corrected';decision.recoveryEvidence=transferred?'different-family':'single-question-two-dates';}
      else if(families.length>=policy.minimumEffectiveFamilies)reason=errorDays>=2||helpDays>=2?'needsExplanation':'reuse';
      else if(needsReview)reason='needsFamilyReview';
      else if(questions.some(q=>q.practiceFor&&!history.some(h=>h.questionId===q.id)))reason='reuse';
      else if(ledger.some(x=>x.target_key===targetKey&&x.generated_day<=date&&E.plusDay(x.generated_day,policy.cooldownDays)>date))reason='cooldown';
      else reason='generate';
      decision.reason=reason;decisions.push(decision);
      if(reason!=='generate'){excluded[reason]++;continue;}
      const q=originals.find(q=>q.id===decision.baseQuestionId),lesson=bank.lessons.find(l=>l.learningTargets?.some(t=>t.questionIds.includes(q.id)));
      const target=lesson?.learningTargets.find(t=>t.questionIds.includes(q.id));
      accepted.push({question:q,lessonId:lesson.id,learningTargetId:target.id,targetKey,unitKey,sourceKinds:decision.sourceKinds,
        neededVariants:Math.max(0,policy.minimumEffectiveFamilies-families.length),effectiveFamilies:families,
        priority:errorDays>=2?0:helpDays>=2&&!history.some(independent)?1:2,latestWeakDay:latest.day,
        lastGeneratedDay:ledger.filter(x=>x.target_key===targetKey).map(x=>x.generated_day).sort().at(-1)||'',decision});
    }
    accepted.sort((a,b)=>a.priority-b.priority||b.latestWeakDay.localeCompare(a.latestWeakDay)||a.lastGeneratedDay.localeCompare(b.lastGeneratedDay)||a.lessonId.localeCompare(b.lessonId));
    const remaining=Math.max(0,policy.maxPerDay-ledger.filter(x=>x.generated_day===date).length),counts=new Map(),candidates=[];
    let budget=remaining;
    for(const c of accepted){
      const count=Math.min(c.neededVariants,policy.maxPerTarget-(counts.get(c.targetKey)||0),budget);
      if(!count){const reason=budget>0?'targetLimit':'dailyLimit';c.decision.reason=reason;excluded[reason]++;continue;}
      counts.set(c.targetKey,(counts.get(c.targetKey)||0)+count);budget-=count;c.neededVariants=count;
      const {decision,...candidate}=c;candidates.push(candidate);
    }
    return {accountId:policy.accountId,expectedRevision:source.revision,expectedVariantRevision:source.variantRevision||0,date,candidates,decisions,excluded,remaining};
  }
  function coverage(source,bank,ledger=[],date=today()){
    const {rows}=evidence(source,bank,ledger,date);
    const active=new Set(E.activePoints(bank,source.bundle.state,date).flatMap(p=>bank.questions.filter(q=>q.pointId===p.id&&q.active!==false).map(q=>E.targetKeys(bank).get(q.id))));
    const first=new Map();
    for(const h of rows)if(active.has(h.targetKey)&&(!first.has(h.targetKey)||h.day<first.get(h.targetKey)))first.set(h.targetKey,h.day);
    const C= [...first.values()].filter(d=>d===date).length;
    const observedDays=new Set(rows.map(h=>h.day));
    return {U:active.size-first.size+C,remainingU:active.size-first.size,C,R:null,sevenDayC:Array.from({length:7},(_,i)=>{
      const d=E.plusDay(date,-i);return {date:d,count:observedDays.has(d)?[...first.values()].filter(v=>v===d).length:null};
    }),
      sevenDayI:null,stableMastery:null};
  }
  return {select,identity,policy,today,coverage,trivialVariant};
});
