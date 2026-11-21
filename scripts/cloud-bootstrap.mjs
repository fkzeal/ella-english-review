import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync,spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {api,restore,pack} from './cloud-state.mjs';
import {recoverCredentials} from './cloud-credentials.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state=path.resolve(process.env.ELLA_STATE_DIR||'/workspace/.ella-automation');
const boot=path.join(root,'.cloud-bootstrap');
process.umask(0o077);fs.mkdirSync(boot,{recursive:true,mode:0o700});
function run(command,args){
  const r=spawnSync(command,args,{cwd:root,env:process.env,encoding:'utf8',timeout:180000,maxBuffer:4000000});
  if(r.status!==0)throw new Error(command+' failed (private output suppressed)');
  return r.stdout;
}
function available(command){return spawnSync(command,['--version'],{stdio:'ignore'}).status===0;}
async function main(){
  recoverCredentials();
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Node 22 or newer required');
  const commit=run('git',['rev-parse','HEAD']).trim();
  if(commit!==run('git',['rev-parse','refs/remotes/origin/main']).trim())throw new Error('Run from latest origin/main snapshot');
  run(process.execPath,['scripts/cloud-access.mjs',boot]);
  const line=fs.readFileSync(path.join(boot,'env.sh'),'utf8').trim();
  const match=line.match(/^export LEARNING_ADMIN_TOKEN='([A-Za-z0-9_-]{40,256})'$/);
  if(!match)throw new Error('Credential file invalid');
  process.env.LEARNING_ADMIN_TOKEN=match[1];
  const owner=randomUUID();await api('lease',{owner});
  let held=true;
  try{
    // A fresh run always restores from the authoritative service, never from a
    // parent session or a fallback bundle. Refuse to replace existing state.
    const restored=await restore(state);
    const session={owner,revision:restored.revision,commit,startedAt:new Date().toISOString()};
    fs.writeFileSync(path.join(boot,'session.json'),JSON.stringify(session),{mode:0o600});
    const checks={github:false,feedback:false,materials:false,ellaSource:false};
    const errors={};
    for(const [name,command,args] of [
      ['github','gh',['api','repos/fkzeal/ella-english-review','--jq','.permissions.push']],
      ['feedback','python3',['scripts/feedback-maintenance.py','--state',path.join(state,'.error-feedback'),'scan']],
      ['materials','python3',['scripts/course-import.py','scan','--state',path.join(state,'.course-imports'),'--download']],
      ['ellaSource',process.execPath,['--import','./scripts/proxy-fetch.mjs','scripts/learning-records.mjs','account-approved','ella']]
    ]){
      try{
        const output=run(command,args);
        fs.writeFileSync(path.join(boot,name+'.private.log'),output,{mode:0o600});
        if(name==='github'&&output.trim()!=='true')throw new Error('GitHub write permission missing');
        checks[name]=true;
      }catch(error){errors[name]=error.message;}
      await api('lease',{owner});
    }
    // These scans may add private evidence. Persist it before completing.
    const {save}=await import('./cloud-state.mjs');
    session.revision=await save(state,session.revision,owner);
    fs.writeFileSync(path.join(boot,'session.json'),JSON.stringify(session),{mode:0o600});
    const runId=process.env.ELLA_BOOTSTRAP_RUN_ID||owner;
    const result={runId,mode:'bootstrap-checks-only',commit,checkedAt:new Date().toISOString(),
      restoredFiles:restored.files,restoredRevision:restored.revision,savedRevision:session.revision,
      credentials:{github:checks.github,admin:checks.ellaSource,lark:checks.feedback&&checks.materials},
      tools:{node:true,python3:available('python3'),gh:available('gh'),lark:available('lark-cli')},
      checks,errors,overall:Object.values(checks).every(Boolean)?'PASS':'PARTIAL'};
    await api('receipt',result);
    fs.writeFileSync(path.join(boot,'result.json'),JSON.stringify(result),{mode:0o600});
    // Keep the distributed lease while the agent evaluates/publishes changes.
    const child=spawn(process.execPath,['--import',path.join(root,'scripts/proxy-fetch.mjs'),
      path.join(root,'scripts/cloud-lease.mjs'),path.join(boot,'session.json')],
      {cwd:root,env:process.env,detached:true,stdio:'ignore'});
    child.unref();held=false;
    console.log(JSON.stringify({...result,stateDirectory:state,sessionFile:path.join(boot,'session.json')}));
  }finally{if(held)await api('lease',{owner,release:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
