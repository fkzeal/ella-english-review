// Public projector: never accepts question bodies or private learning records.
'use strict';
const fs=require('node:fs'),path=require('node:path');
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
  only(input,['runId','date','createdAt','status','summary','sections','questions','todos','verification']);
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(input.runId)||!/^\d{4}-\d{2}-\d{2}$/.test(input.date)||!Number.isFinite(Date.parse(input.createdAt)))throw new Error('Invalid run identity');
  const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(input.createdAt));
  if(localDate!==input.date)throw new Error('Date must match Shanghai execution time');
  if(!['framework','published','no-change','partial','failed'].includes(input.status))throw new Error('Invalid status');
  only(input.sections,keys);
  const sections={};
  for(const key of keys){const section=input.sections[key];only(section,['value','note']);sections[key]={value:text(section.value,40),note:text(section.note)};}
  // Public reports reveal no learner answer counts, mistakes, devices, or event data.
  if(sections.derivatives.value!=='未生成'||sections.derivatives.note!=='受控生成账本与定向分发尚未完成。')throw new Error('Private derivative reporting is not enabled');
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
  if(input.status==='no-change'&&questions.length)throw new Error('No-change report cannot claim changed questions');
  const count=questions.filter(q=>q.change==='added').length;
  if(sections.questions.value!==String(count))throw new Error('New question count mismatch (samples and replacements excluded)');
  for(const [key,change] of [['fixes','fixed'],['optimizations','optimized']]){
    const value=sections[key].value;
    if(/^\d+$/.test(value)&&Number(value)!==questions.filter(q=>q.change===change).length)throw new Error(`${key} count mismatch`);
  }
  return {runId:input.runId,date:input.date,createdAt:new Date(input.createdAt).toISOString(),status:input.status,summary:text(input.summary),bankRevision:bank.revision,sections,questions,todos:input.todos.map(t=>text(t)),...(verification?{verification}: {})};
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
  const base=baseFile&&baseFile!=='-'?JSON.parse(fs.readFileSync(baseFile,'utf8')):undefined;
  const archive=JSON.parse(fs.readFileSync(destination,'utf8'));
  const next=merge(archive,project(input,bank,base));
  const temp=destination+'.tmp';fs.writeFileSync(temp,JSON.stringify(next,null,2)+'\n',{mode:0o644});fs.renameSync(temp,destination);
  console.log(`Public report saved: ${input.date} / ${input.runId}`);
}
module.exports={project,merge};
