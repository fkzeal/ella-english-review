// Recover the existing admin secret using authenticated Actions dispatch.
// GitHub credentials come from the runtime's authorized integration/environment.
import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,privateDecrypt,createDecipheriv,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const directory=path.resolve(process.argv[2]||'.cloud-bootstrap');
process.umask(0o077);fs.mkdirSync(directory,{recursive:true,mode:0o700});
function gh(args){
  const r=spawnSync('gh',args,{encoding:'utf8',env:{...process.env,GH_DEBUG:''},timeout:30000,maxBuffer:2000000});
  if(r.status!==0)throw new Error('GitHub access unavailable (credential values suppressed)');
  return r.stdout;
}
try{
  let token=process.env.LEARNING_ADMIN_TOKEN,source='runtime-environment';
  if(!token){
    if(gh(['api','repos/fkzeal/ella-english-review','--jq','.permissions.push']).trim()!=='true')
      throw new Error('Repository write permission required');
    const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:3072});
    const id=randomUUID(),key=publicKey.export({type:'spki',format:'der'}).toString('base64');
    gh(['workflow','run','maintenance-access.yml','--repo','fkzeal/ella-english-review','--ref','main',
      '-f','recipient_public_key='+key,'-f','request_id='+id]);
    let run;
    for(let i=0;i<36;i++){
      const runs=JSON.parse(gh(['run','list','--repo','fkzeal/ella-english-review','--workflow','maintenance-access.yml',
        '--limit','50','--json','databaseId,displayTitle,status,conclusion']));
      run=runs.find(r=>r.displayTitle==='Maintenance bootstrap '+id);
      if(run?.status==='completed')break;
      await new Promise(resolve=>setTimeout(resolve,5000));
    }
    if(run?.conclusion!=='success')throw new Error('Encrypted credential workflow did not succeed');
    gh(['run','download',String(run.databaseId),'--repo','fkzeal/ella-english-review',
      '--name','encrypted-maintenance-access','--dir',directory]);
    const artifact=path.join(directory,'maintenance-access.encrypted.json');
    const envelope=JSON.parse(fs.readFileSync(artifact));
    const secret=privateDecrypt({key:privateKey,oaepHash:'sha256'},Buffer.from(envelope.key,'base64'));
    const cipher=createDecipheriv('aes-256-gcm',secret,Buffer.from(envelope.iv,'base64'));
    cipher.setAuthTag(Buffer.from(envelope.tag,'base64'));
    token=JSON.parse(Buffer.concat([cipher.update(Buffer.from(envelope.ciphertext,'base64')),cipher.final()])).LEARNING_ADMIN_TOKEN;
    fs.rmSync(artifact);source='github-actions-encrypted-artifact';
  }
  if(typeof token!=='string'||!/^[A-Za-z0-9_-]{40,256}$/.test(token))throw new Error('Invalid administration credential');
  fs.writeFileSync(path.join(directory,'env.sh'),"export LEARNING_ADMIN_TOKEN='"+token+"'\n",{mode:0o600});
  console.log(JSON.stringify({credentialReady:true,source}));
}catch{
  console.error('Credential recovery failed: authenticated GitHub Actions access or runtime admin credential is required. No inherited local file is used.');
  process.exitCode=1;
}
