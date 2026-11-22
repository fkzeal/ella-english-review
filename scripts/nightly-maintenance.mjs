import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import P from '../practice.js';
import E from '../engine.js';
import {recoverCredentials} from './cloud-credentials.mjs';
import {api,save} from './cloud-state.mjs';
import Report from './update-nightly-report.js';
import {fetchJson} from './http-json.mjs';
import {verifyProductionState} from './verify-production-state.mjs';
import {readReportDerivatives,derivativeNote} from './report-derivatives.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const boot=path.join(root,'.cloud-bootstrap'),state=path.resolve(process.env.ELLA_STATE_DIR||'/workspace/.ella-automation');
const base='https://ella-english-review.pages.dev',sha=x=>createHash('sha256').update(x).digest('hex');
const journalFile=path.join(boot,'maintenance.private.json');
process.umask(0o077);
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600});}
function run(args,timeout=180000){
  const r=spawnSync(args[0],args.slice(1),{cwd:root,env:process.env,encoding:'utf8',maxBuffer:2000000,timeout});
  if(r.status!==0){
    write(path.join(boot,'command-failure.private.json'),{command:args[0],status:r.status,code:r.error?.code,stderr:r.stderr});
    throw new Error('Required command failed ('+(r.error?.code||'exit '+r.status)+'); inspect .cloud-bootstrap/command-failure.private.json privately');
  }
  return r.stdout.trim();
}
async function privateApi(route,data){
  const response=await fetchJson(base+'/api/admin/practice/'+route,{method:data?'POST':'GET',
    headers:{Authorization:'Bearer '+process.env.LEARNING_ADMIN_TOKEN,Origin:base,'Content-Type':'application/json'},
    ...(data?{body:JSON.stringify(data)}:{})});
  if(!response.ok)throw new Error('Private practice HTTP '+response.status);
  return response.body;
}
async function checkpoint(journal){
  write(journalFile,journal);write(path.join(state,'operations',journal.runId+'.json'),journal);
  const session=JSON.parse(fs.readFileSync(path.join(boot,'session.json')));
  await api('lease',{owner:session.owner});
  session.revision=await save(state,session.revision,session.owner);write(path.join(boot,'session.json'),session);
}
async function source(){
  const source=await privateApi('source?accountId=ella');
  const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json')));
  source.fingerprints=Object.fromEntries([...bank.questions,...source.bundle.bank.questions.filter(q=>q.practiceFor)].map(q=>[q.id,sha(P.identity(q))]));
  return {source,bank,selection:P.select(source,bank,source.ledger,P.today())};
}
async function verifyPrivate(journal){
  if(!journal.publication)return {verified:true,count:0};
  const readback=await privateApi('publish?accountId=ella&runId='+journal.runId);
  readback.questions=readback.receipt.questionIds.map(id=>readback.questions.find(q=>q.id===id));
  if(!readback.visible||readback.receipt.checksum!==sha(JSON.stringify(readback.questions))||readback.receipt.count!==readback.questions.length||
    JSON.stringify(readback.receipt)!==JSON.stringify(journal.publication))throw new Error('Private readback mismatch');
  return {verified:true,count:readback.receipt.count,runId:journal.runId,checksum:readback.receipt.checksum};
}
async function main(){
  recoverCredentials();
  process.env.GH_DEBUG='';
  const [command,file]=process.argv.slice(2);
  if(command==='start'){
    if(!fs.existsSync(path.join(boot,'session.json')))run([process.execPath,'--import','./scripts/proxy-fetch.mjs','scripts/cloud-bootstrap.mjs'],900000);
    if(!fs.existsSync(path.join(boot,'result.json')))throw new Error('Bootstrap interrupted: inspect progress receipt before resuming; never reuse an incomplete session');
    if(fs.existsSync(journalFile))throw new Error('Run already started; preserve and resume journal');
    const journal={runId:randomUUID(),mode:process.env.ELLA_RUN_MODE||'manual',startedAt:new Date().toISOString(),commit:run(['git','rev-parse','HEAD'])};
    write(path.join(boot,'base-bank.private.json'),JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'))));
    await checkpoint(journal);console.log(JSON.stringify({runId:journal.runId,journalFile}));return;
  }
  const journal=JSON.parse(fs.readFileSync(journalFile));
  if(command==='candidates'){
    const {source:src,selection}=await source();
    write(path.join(boot,'source.private.json'),src);write(path.join(boot,'candidates.private.json'),selection);
    write(path.join(state,'operations',journal.runId+'-selection.private.json'),selection);
    journal.selection={read:true,revision:src.revision,candidateCount:selection.candidates.length,excluded:selection.excluded,date:selection.date,
      coverage:P.coverage(src,JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'))),src.ledger,selection.date)};
    await checkpoint(journal);
    console.log(JSON.stringify({candidates:selection.candidates.length,file:path.join(boot,'candidates.private.json')}));return;
  }
  if(command==='publish-private'){
    // Resume the identical saved payload after a lost response; never regenerate it.
    const payloadFile=path.join(boot,'publication-payload.private.json');
    if(!fs.existsSync(payloadFile)){
      const {source:src,bank,selection}=await source(),input=JSON.parse(fs.readFileSync(file));
      if(input.reviewed!==true)throw new Error('Content review required');
      const families=[];
      const questions=input.questions.map(item=>{
        const {variantFamily,...q}=item;
        const candidate=selection.candidates.find(c=>c.question.id===q.baseQuestionId);
        if(!candidate)throw new Error('Candidate changed');
        const content=JSON.stringify([q.baseQuestionId,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer]);
        const id='practice-'+sha(content).slice(0,24);families.push({questionId:id,variantFamily});
        return {...q,id,practiceFor:'ella',pointId:candidate.question.pointId,
          reviewUnit:candidate.question.reviewUnit,learningTargetId:candidate.learningTargetId,baseFingerprint:sha(P.identity(candidate.question))};
      });
      write(payloadFile,{accountId:'ella',runId:journal.runId,expectedRevision:src.revision,expectedVariantRevision:src.variantRevision||0,
        publicBank:bank,reviewed:true,questions,variantFamilies:families});
      journal.beforeStateHash=sha(JSON.stringify(src.bundle.state));await checkpoint(journal);
    }
    journal.publication=await privateApi('publish',JSON.parse(fs.readFileSync(payloadFile)));
    journal.privateVerification=await verifyPrivate(journal);
    const after=await privateApi('source?accountId=ella');
    if(sha(JSON.stringify(after.bundle.state))!==journal.beforeStateHash)throw new Error('Account state changed; inspect concurrent writes');
    journal.statePreserved=true;await checkpoint(journal);
    console.log(JSON.stringify({published:journal.publication.count,verified:true,statePreserved:true}));return;
  }
  if(command==='review-families'){
    const payloadFile=path.join(boot,'family-review-payload.private.json');
    if(!fs.existsSync(payloadFile)){
      const {source:src,bank}=await source(),input=JSON.parse(fs.readFileSync(file));
      if(input.reviewed!==true)throw new Error('Family review required');
      write(payloadFile,{accountId:'ella',expectedRevision:src.revision,expectedVariantRevision:src.variantRevision||0,publicBank:bank,reviewed:true,reviews:input.reviews});
      journal.familyBeforeStateHash=sha(JSON.stringify(src.bundle.state));await checkpoint(journal);
    }
    const payload=JSON.parse(fs.readFileSync(payloadFile)),before=await privateApi('source?accountId=ella');
    const contains=src=>payload.reviews.every(r=>src.variantReviews?.some(x=>x.questionId===r.questionId&&x.fingerprint===r.fingerprint&&x.variantFamily===r.variantFamily&&x.status===r.status&&x.note===r.note));
    if(!contains(before))await privateApi('variants',payload);
    const after=await privateApi('source?accountId=ella');
    if(!contains(after)||sha(JSON.stringify(after.bundle.state))!==journal.familyBeforeStateHash)throw new Error('Family review readback/state mismatch');
    journal.familyReview={verified:true,count:payload.reviews.length,variantRevision:after.variantRevision,statePreserved:true};await checkpoint(journal);
    console.log(JSON.stringify(journal.familyReview));return;
  }
  if(command==='report'){
    if(!journal.selection?.read)throw new Error('Read source before reporting');
    const input=JSON.parse(fs.readFileSync(file));
    input.runId=journal.runId;
    await verifyPrivate(journal);
    input.privateVerification=await readReportDerivatives(journal.runId);
    input.sections.derivatives={value:String(input.privateVerification.count),note:derivativeNote};
    const x=journal.selection.excluded;
    input.generationSummary={generated:input.privateVerification.count,reuse:x.reuse,recovered:x.corrected,needsExplanation:x.needsExplanation,
      cooldown:x.cooldown,invalidRecords:x.invalid,needsFamilyReview:x.needsFamilyReview,needsMaterial:x.needsMaterial,dailyLimit:x.dailyLimit,targetLimit:x.targetLimit,
      coverage:journal.selection.coverage};
    journal.reportDerivatives={count:input.privateVerification.count,checksum:sha(JSON.stringify(input.privateVerification.questions))};
    const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'))),prior=JSON.parse(fs.readFileSync(path.join(boot,'base-bank.private.json')));
    const destination=path.join(root,'updates/reports.json');
    const report=Report.project(input,bank,prior),archive=JSON.parse(fs.readFileSync(destination));
    fs.writeFileSync(destination,JSON.stringify(Report.merge(archive,report),null,2)+'\n',{mode:0o644});
    journal.reportRunId=input.runId;await checkpoint(journal);console.log(JSON.stringify({runId:input.runId,reportSaved:true}));return;
  }
  if(command==='finish'){
    const evidence=JSON.parse(fs.readFileSync(file));
    const bootstrap=JSON.parse(fs.readFileSync(path.join(boot,'result.json')));
    if(bootstrap.overall!=='PASS'||!journal.selection?.read||evidence.materialsReviewed!==true||evidence.feedbackReviewed!==true||evidence.browserVerified!==true||
      evidence.pendingOperationsResolved!==true)throw new Error('Full source review and browser evidence required');
    if(journal.selection.candidateCount>0&&!journal.publication)throw new Error('Eligible derivative branch not completed');
    const workflow=JSON.parse(run(['gh','run','view',String(evidence.actionsRun),'--repo','fkzeal/ella-english-review','--json','conclusion,headSha,workflowName']));
    if(workflow.conclusion!=='success'||workflow.headSha!==evidence.reportCommit||workflow.workflowName!=='Publish fixed Cloudflare Pages site')throw new Error('Production Actions not verified');
    const bankResponse=await fetchJson(base+'/question-bank.json',{headers:{'Cache-Control':'no-cache'}});
    const reportResponse=await fetchJson(base+'/updates/reports.json',{headers:{'Cache-Control':'no-cache'}});
    if(!bankResponse.ok||!reportResponse.ok||journal.reportRunId!==journal.runId)throw new Error('Production publication unavailable');
    verifyProductionState(JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'))),bankResponse.body,
      JSON.parse(fs.readFileSync(path.join(root,'updates/reports.json'))),reportResponse.body,journal.runId);
    journal.privateVerification=await verifyPrivate(journal);
    if(journal.reportDerivatives){
      const derivatives=await readReportDerivatives(journal.runId);
      if(derivatives.count!==journal.reportDerivatives.count||sha(JSON.stringify(derivatives.questions))!==journal.reportDerivatives.checksum)
        throw new Error('Published derivative report changed; regenerate report');
    }
    journal.evidence=evidence;journal.finishedAt ||= new Date().toISOString();
    journal.mode=['schedule','schedule-maintenance-complete'].includes(journal.mode)?'schedule-maintenance-complete':'manual-maintenance-complete';journal.overall='PASS';
    await checkpoint(journal);await api('receipt',journal);
    const receipt=await api('receipt?run='+journal.runId);
    if(JSON.stringify(receipt)!==JSON.stringify(journal))throw new Error('Completion receipt mismatch');
    run([process.execPath,'--import','./scripts/proxy-fetch.mjs','scripts/cloud-state.mjs','release',path.join(boot,'session.json')]);
    fs.rmSync(path.join(boot,'env.sh'),{force:true});
    console.log(JSON.stringify({runId:journal.runId,mode:journal.mode,overall:'PASS',privatePublished:journal.privateVerification.count}));return;
  }
  throw new Error('Expected start/candidates/review-families/publish-private/report/finish');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
