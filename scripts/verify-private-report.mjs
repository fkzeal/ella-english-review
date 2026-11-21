import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {recoverCredentials} from './cloud-credentials.mjs';
recoverCredentials();
const input=JSON.parse(fs.readFileSync(process.argv[2])),base='https://ella-english-review.pages.dev';
if(input.privateVerification?.verified!==true)throw new Error('Private verification required');
const count=input.privateVerification.count;
const route=count>0?'publish?accountId=ella&runId='+input.runId:'source?accountId=ella';
const response=await fetch(base+'/api/admin/practice/'+route,{headers:{Authorization:'Bearer '+process.env.LEARNING_ADMIN_TOKEN}});
if(!response.ok)throw new Error('Private receipt unavailable');
const result=await response.json();
if(count>0)result.questions=result.receipt.questionIds.map(id=>result.questions.find(q=>q.id===id));
if(count>0&&(!result.visible||result.receipt.count!==count||result.receipt.runId!==input.runId||
 result.receipt.checksum!==createHash('sha256').update(JSON.stringify(result.questions)).digest('hex')))throw new Error('Private receipt mismatch');
console.log('verified');
