// Private agent/parent interface. No credentials in URLs, static assets or output.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest,questionIdentity} from '../learning-server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tokenFile=path.join(root,'.learning-server/admin-token');
const token=process.env.LEARNING_ADMIN_TOKEN||(fs.existsSync(tokenFile)?fs.readFileSync(tokenFile,'utf8').trim():'');
if(!token)throw new Error('私有查询缺少 LEARNING_ADMIN_TOKEN；不得改为匿名读取');
const base='https://ella-english-review.pages.dev';
const [command='devices',deviceId,name]=process.argv.slice(2);
async function query(route,body){
  const r=await fetch(base+'/api/admin/'+route,{method:body?'POST':'GET',
    headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json',Origin:base}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data;
}
if(command==='accounts'){
  const data=await query('accounts');console.table(data.accounts);
}else if(command==='account-inspect'){
  if(!deviceId)throw new Error('account-inspect 需要明确账号编号');
  const data=await query('account-inspect?'+new URLSearchParams({accountId:deviceId}));
  const dir=path.join(root,'.learning-server');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'inspect-'+deviceId+'.json');
  fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600});
  console.log('账号设备与复习状态已保存到私有文件（不输出详细作答或设备编号）。');
}else if(command==='account-code'){
  if(!deviceId)throw new Error('account-code 需要账号编号，例如 ella');
  const data=await query('account-code',{accountId:deviceId});
  const dir=path.join(root,'.learning-server');fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=path.join(dir,'account-'+data.accountId+'.json');
  fs.writeFileSync(file,JSON.stringify(data,null,2),{mode:0o600});
  console.log('登录码已写入私有文件：'+file+'（不要提交或公开）');
}else if(['account-records','account-approved'].includes(command)){
  const generation=command==='account-approved';
  const data=await query('account-records?'+new URLSearchParams({accountId:deviceId||'ella',generation:String(generation)}));
  const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'),'utf8'));
  const valid=new Set(await Promise.all(bank.questions.filter(q=>q.active!==false).map(q=>digest(questionIdentity(q)))));
  for(const row of data.records)if(!generation||valid.has(row.fingerprint)){
    const q=bank.questions.find(q=>q.id===row.questionId),p=bank.points.find(p=>p.id===q?.pointId),lesson=bank.lessons.find(l=>l.id===p?.lessonId);
    console.log(JSON.stringify({...row,question:q?{...q,lessonId:p.lessonId,pointTitle:p.title,pointEvidence:p.evidence,lessonTitle:lesson.title,revision:bank.revision}:null}));
  }
}else if(command==='devices'){
  const data=await query('devices');
  console.table(data.devices.map(d=>({设备编号:d.id,名称:d.name||'待命名',确认:Boolean(d.approved),作答:d.answerCount,答错次数:d.wrongCount,错题版本数:d.wrongQuestionCount,新作答:d.liveCount,历史回补:d.backfillCount,导入:d.importedCount})));
}else if(['approve','exclude'].includes(command)){
  if(!deviceId)throw new Error('请提供家长已确认的完整设备编号');
  console.log(await query('device',{deviceId,name:name||'',approved:command==='approve'}));
}else if(['records','approved'].includes(command)){
  if(command==='records'&&!deviceId)throw new Error('records 需要完整设备编号');
  const params=new URLSearchParams(command==='approved'?{approvedOnly:'true'}:{deviceId});
  params.set('limit','500');
  // Fail closed for nightly generation: exclude old/disabled/repaired question identities.
  const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'),'utf8'));
  const valid=new Set(await Promise.all(bank.questions.filter(q=>q.active!==false).map(q=>digest(questionIdentity(q)))));
  let cursor=null;
  do{
    if(cursor)params.set('cursor',cursor);
    const data=await query('records?'+params);
    for(const row of data.records){
      if(command==='approved'&&!valid.has(row.fingerprint))continue;
      console.log(JSON.stringify(row));
    }
    cursor=data.nextCursor;
  }while(cursor);
}else throw new Error('使用 accounts | account-inspect <id> | account-code <id> | account-records <id> | account-approved [ella] | devices | records <id> | approved | approve <id> <名称> | exclude <id> <名称>');
