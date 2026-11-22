import {createHash} from 'node:crypto';
import {fetchJson} from './http-json.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
export const derivativeNote='已发布衍生题的详情统一展示，不区分账号。';
const fields=['id','pointId','reviewUnit','learningTargetId','type','prompt','options','answer','explanation','passage','audioText','references'];
export function verifyDerivativePublications(result,runId){
  if(result?.runId!==runId||!Array.isArray(result.publications))throw new Error('Derivative report readback unavailable');
  const questions=new Map(),accounts=new Set();
  for(const {receipt,questions:raw} of result.publications){
    if(!receipt||receipt.runId!==runId||typeof receipt.accountId!=='string'||accounts.has(receipt.accountId)||
      !Array.isArray(raw)||receipt.count!==raw.length||receipt.count!==receipt.questionIds?.length||
      new Set(receipt.questionIds).size!==raw.length)throw new Error('Derivative publication receipt mismatch');
    accounts.add(receipt.accountId);
    const ordered=receipt.questionIds.map(id=>raw.find(q=>q.id===id));
    if(ordered.some(q=>!q||q.practiceFor!==receipt.accountId)||sha(JSON.stringify(ordered))!==receipt.checksum)
      throw new Error('Derivative publication checksum mismatch');
    for(const q of ordered){
      const content=Object.fromEntries(fields.filter(key=>q[key]!==undefined).map(key=>[key,q[key]]));
      if(questions.has(q.id)&&JSON.stringify(questions.get(q.id))!==JSON.stringify(content))
        throw new Error('Conflicting derivative question identity');
      questions.set(q.id,content);
    }
  }
  return {verified:true,count:questions.size,questions:[...questions.values()]};
}
export async function readReportDerivatives(runId){
  const response=await fetchJson('https://ella-english-review.pages.dev/api/admin/practice/report?runId='+encodeURIComponent(runId),
    {headers:{Authorization:'Bearer '+process.env.LEARNING_ADMIN_TOKEN,'Cache-Control':'no-cache'}});
  if(!response.ok)throw new Error('Derivative report HTTP '+response.status);
  return verifyDerivativePublications(response.body,runId);
}
