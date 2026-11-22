import fs from 'node:fs';
import path from 'node:path';
import {recoverCredentials} from './cloud-credentials.mjs';
import {fetchJson} from './http-json.mjs';
recoverCredentials();
const response=await fetchJson('https://ella-english-review.pages.dev/api/admin/practice/source?accountId=ella',{
  headers:{Authorization:'Bearer '+process.env.LEARNING_ADMIN_TOKEN}});
if(!response.ok)throw new Error('Private source HTTP '+response.status);
const source=response.body;
if(source.account?.id!=='ella'||source.account.kind!=='learner'||source.bundle?.state.accountId!=='ella'||
  !Array.isArray(source.bundle.state.history)||!Array.isArray(source.ledger))throw new Error('Invalid learner source response');
const dir=path.resolve('.cloud-bootstrap');
fs.mkdirSync(dir,{recursive:true,mode:0o700});
fs.writeFileSync(path.join(dir,'source-check.private.json'),JSON.stringify(source),{mode:0o600});
console.log(JSON.stringify({read:true,revision:source.revision,historyRead:true,ledgerRead:true}));
