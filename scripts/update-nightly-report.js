// Shared bodies come from the bank; derivative bodies from verified publications.
'use strict';
const fs=require('node:fs'),path=require('node:path');
const E=require('../engine');
const keys=['materials','questions','fixes','optimizations','derivatives'];
function only(object,allowed){
  if(!object||typeof object!=='object'||Array.isArray(object))throw new Error('Expected object');
  for(const key of Object.keys(object))if(!allowed.includes(key))throw new Error(`Unsupported public field: ${key}`);
}
function text(value,max=500){
  if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error('Invalid public text');
  if(/(?:LEARNING_ADMIN_TOKEN|Bearer\s|https?:\/\/|ou_[a-z\d]{10,}|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12})/i.test(value))throw new Error('Private identifier or link in public text');
  return value;
}
function project(input,bank,base){
  only(input,['runId','date','createdAt','status','summary','sections','questions','todos','verification','privateVerification','generationSummary']);
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(input.runId)||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.createdAt)))throw new Error('Invalid run identity');
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(input.createdAt));
  if(localDate!==input.date)throw new Error('Date must match Shanghai execution time');
  if(!['framework','published','no-change','partial','failed'].includes(input.status))throw new Error('Invalid status');
  only(input.sections,keys);
  const sections={};
  for(const key of keys){const section=input.sections[key];only(section,['value','note']);sections[key]={value:text(section.value,40),note:text(section.note)};}
  const detailedDerivatives=sections.derivatives.note==='已发布衍生题的详情统一展示，不区分账号。';
  // Legacy archived summaries remain readable. New detailed reports require bodies.
  if(sections.derivatives.value!=='未生成'||sections.derivatives.note!=='受控生成账本与定向分发尚未完成。'){
    const receipt=input.privateVerification;
    if(!receipt||receipt.verified!==true||!Number.isSafeInteger(receipt.count)||receipt.count<0||
      sections.derivatives.value!==String(receipt.count)||(!detailedDerivatives&&sections.derivatives.note!=='私有巩固练习已核验；仅展示本轮发布数量。'))throw new Error('Private derivative receipt required');
    if(detailedDerivatives&&(!Array.isArray(receipt.questions)||receipt.questions.length!==receipt.count))throw new Error('Complete derivative question details required');
  }
  const verification=input.verification;
  if(verification){
    only(verification,['commit','actionsRun','bankVerified']);
    if(!/^[a-f\d]{40}$/.test(verification.commit)||!/^\d+$/.test(verification.actionsRun)||verification.bankVerified!==true)throw new Error('Invalid production receipt');
  }
  if(input.status==='published'&&!verification)throw new Error('Published bank needs verified production receipt');
  if(!Array.isArray(input.questions)||!Array.isArray(input.todos))throw new Error('Expected lists');
  const seen=new Set();
  const questions=input.questions.map(item=>{
    only(item,['id','change','reason']);
    if(seen.has(item.id))throw new Error('Duplicate question');seen.add(item.id);
    if(!['sample','added','fixed','optimized'].includes(item.change))throw new Error('Invalid change type');
    const q=bank.questions.find(q=>q.id===item.id&&q.active!==false);
    if(!q)throw new Error('Question absent from shared bank');
    if(input.status==='framework'&&item.change!=='sample')throw new Error('Framework can only contain existing samples');
    if(input.status!=='framework'&&item.change==='sample')throw new Error('Samples belong only to framework');
    if(item.change!=='sample'&&!verification)throw new Error('Question changes must already be production verified');
    if(item.change!=='sample'&&!base)throw new Error('Need pre-run bank to verify changes');
    const prior=base?.questions.find(old=>old.id===q.id);
    if(item.change==='added'&&prior)throw new Error('Existing question is not new');
    if(item.change==='optimized'&&!prior)throw new Error('Optimization must change an existing question');
    if(prior&&item.change!=='sample'){
      if(JSON.stringify(prior)===JSON.stringify(q))throw new Error('Reported correction or optimization must change an existing question');
      for(const key of ['pointId','reviewUnit','type','prompt','options','answer','audioText','passage']){
        if(JSON.stringify(prior[key])!==JSON.stringify(q[key]))throw new Error('Evaluation change requires a new question identity');
      }
    }
    const lesson=bank.lessons.find(l=>l.learningTargets?.some(t=>t.questionIds.includes(q.id)));
    const target=lesson?.learningTargets.find(t=>t.questionIds.includes(q.id));
    if(!lesson||!target)throw new Error('Missing precise learning target');
    const output={id:q.id,change:item.change,reason:text(item.reason),lesson:lesson.title,target:target.title,reviewUnit:q.reviewUnit,type:q.type};
    for(const key of ['prompt','options','answer','explanation','passage','audioText'])if(q[key]!==undefined)output[key]=q[key];
    output.references=(q.references||[]).map(ref=>({kind:ref.kind,text:ref.text,source:ref.source}));
    return output;
  });
  if(detailedDerivatives){
    for(const q of input.privateVerification.questions){
      only(q,['id','pointId','reviewUnit','learningTargetId','type','prompt','options','answer','explanation','passage','audioText','references']);
      if(typeof q.id!=='string'||!/^practice-[a-f\d]{24}$/.test(q.id)||seen.has(q.id))throw new Error('Duplicate or invalid derivative question');
      seen.add(q.id);
      const point=bank.points.find(p=>p.id===q.pointId),lesson=bank.lessons.find(l=>l.id===point?.lessonId);
      const target=lesson?.learningTargets.find(t=>t.id===q.learningTargetId);
      if(!target||typeof q.reviewUnit!=='string'||!q.reviewUnit||!['choice','cloze','reading','listening'].includes(q.type)||
        !Array.isArray(q.options)||q.options.length<2||q.options.some(o=>typeof o!=='string'||!o.trim())||
        !Number.isInteger(q.answer)||q.answer<0||q.answer>=q.options.length||!Array.isArray(q.references)||!q.references.length)
        throw new Error('Invalid published derivative details');
      const output={id:q.id,change:'derived',reason:'已发布的衍生巩固练习。',lesson:lesson.title,target:target.title,
        reviewUnit:q.reviewUnit,type:q.type,prompt:text(q.prompt,5000),options:q.options.map(o=>text(o,5000)),
        answer:q.answer,explanation:text(q.explanation,5000)};
      for(const key of ['passage','audioText'])if(q[key]!==undefined)output[key]=text(q[key],20000);
      output.references=q.references.map(ref=>{
        only(ref,['kind','text','source']);
        if(!['original','excerpt','note','practice'].includes(ref.kind))throw new Error('Invalid derivative reference');
        return {kind:ref.kind,text:text(ref.text,20000),source:text(ref.source)};
      });
      questions.push(output);
    }
  }
  if(input.status==='no-change'&&questions.some(q=>q.change!=='derived'))throw new Error('No-change report cannot claim changed shared questions');
  const count=questions.filter(q=>q.change==='added').length;
  if(sections.questions.value!==String(count))throw new Error('New question count mismatch (samples and replacements excluded)');
  for(const [key,change] of [['fixes','fixed'],['optimizations','optimized']]){
    const value=sections[key].value;
    if(/^\d+$/.test(value)&&Number(value)!==questions.filter(q=>q.change===change).length)throw new Error(`${key} count mismatch`);
  }
  const activeTargets=b=>new Set(b.questions.filter(q=>q.active!==false&&!q.practiceFor).map(q=>E.targetKeys(b).get(q.id)));
  const priorTargets=base?activeTargets(base):null;
  const targetCounts={newTargets:priorTargets?[...activeTargets(bank)].filter(k=>!priorTargets.has(k)).length:null,
    derivativeQuestions:input.privateVerification?.count??0,derivativeNewTargets:0};
  let generationSummary;
  if(input.generationSummary){
    const g=input.generationSummary;
    only(g,['generated','reuse','recovered','needsExplanation','cooldown','invalidRecords','needsFamilyReview','needsMaterial','dailyLimit','coverage']);
    generationSummary={};
    for(const key of ['generated','reuse','recovered','needsExplanation','cooldown','invalidRecords','needsFamilyReview','needsMaterial','dailyLimit']){
      if(!Number.isSafeInteger(g[key])||g[key]<0)throw new Error('Invalid generation aggregate');
      generationSummary[key]=g[key];
    }
    if(g.generated!==targetCounts.derivativeQuestions)throw new Error('Generation count receipt mismatch');
    const c=g.coverage;only(c,['U','remainingU','C','R','sevenDayC','sevenDayI','stableMastery']);
    for(const key of ['U','remainingU','C','R','stableMastery'])if(c[key]!==null&&(!Number.isSafeInteger(c[key])||c[key]<0))throw new Error('Invalid coverage aggregate');
    if(c.sevenDayI!==null||!Array.isArray(c.sevenDayC)||c.sevenDayC.length!==7)throw new Error('Historical target growth unavailable');
    for(const row of c.sevenDayC){only(row,['date','count']);if(!/^\d{4}-\d{2}-\d{2}$/.test(row.date)||(row.count!==null&&(!Number.isSafeInteger(row.count)||row.count<0)))throw new Error('Invalid daily coverage');}
    generationSummary.coverage=c;
  }
  return {runId:input.runId,date:input.date,createdAt:new Date(input.createdAt).toISOString(),status:input.status,summary:text(input.summary),bankRevision:bank.revision,sections,questions,todos:input.todos.map(t=>text(t)),targetCounts,...(generationSummary?{generationSummary}:{}),...(verification?{verification}: {})};
}
function merge(archive,report){
  only(archive,['version','reports']);
  if(archive.version!==1||!Array.isArray(archive.reports))throw new Error('Invalid archive; never reset');
  const old=archive.reports.find(r=>r.runId===report.runId);
  if(old&&Date.parse(old.createdAt)>Date.parse(report.createdAt))throw new Error('Refusing stale run overwrite');
  return {version:1,reports:[...archive.reports.filter(r=>r.runId!==report.runId),report].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.runId.localeCompare(a.runId))};
}
if(require.main===module){
  const [file,baseFile,reviewed]=process.argv.slice(2);
  if(!file||reviewed!=='--public-reviewed')throw new Error('Usage: node scripts/update-nightly-report.js PRIVATE_INPUT BASE_BANK --public-reviewed (BASE_BANK may be - for no changes)');
  const root=path.resolve(__dirname,'..'),destination=path.join(root,'updates/reports.json');
  const input=JSON.parse(fs.readFileSync(file,'utf8')),bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'),'utf8'));
  if(input.privateVerification){
    const result=require('node:child_process').spawnSync(process.execPath,['--import',path.join(root,'scripts/proxy-fetch.mjs'),path.join(root,'scripts/verify-private-report.mjs'),file],{cwd:root,env:process.env,encoding:'utf8'});
    if(result.status!==0)throw new Error('Private publication not verified online');
    input.privateVerification=JSON.parse(result.stdout);
    input.sections.derivatives={value:String(input.privateVerification.count),note:'已发布衍生题的详情统一展示，不区分账号。'};
  }
  const base=baseFile&&baseFile!=='-'?JSON.parse(fs.readFileSync(baseFile,'utf8')):undefined;
  const archive=JSON.parse(fs.readFileSync(destination,'utf8'));
  const next=merge(archive,project(input,bank,base));
  const temp=destination+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o644});fs.renameSync(temp,destination);
  console.log(`Public report saved: ${input.date} / ${input.runId}`);
}
module.exports={project,merge};
