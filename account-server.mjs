import R from './rewards.js';
import S from './account-state.js';

export const ACCOUNTS=[
  {id:'ella',name:'Ella',kind:'learner'},{id:'dad',name:'爸爸',kind:'parent'},
  {id:'mom',name:'妈妈',kind:'parent'},{id:'test-1',name:'测试一',kind:'test'},
  {id:'test-2',name:'测试二',kind:'test'},{id:'test-3',name:'测试三',kind:'test'}
];
const encoder=new TextEncoder(),uuid=/^[0-9a-f-]{36}$/;
const hex=bytes=>[...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('');
const digest=async text=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
const identity=q=>JSON.stringify([q.id,q.pointId,q.reviewUnit||null,q.learningTarget||null,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer,q.active!==false]);
export async function accountCode(secret,id){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return hex(await crypto.subtle.sign('HMAC',key,encoder.encode('ella-account-v1:'+id))).slice(0,24);
}
export async function accountSeeds(secret){
  return await Promise.all(ACCOUNTS.map(async a=>({...a,codeHash:await digest(await accountCode(secret,a.id))})));
}
function fail(status,message){throw Object.assign(new Error(message),{status});}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function read(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'需要 JSON');
  if(Number(request.headers.get('content-length')||0)>12000000)fail(413,'记录超过12MB，请联系家长导出备份');
  const text=await request.text();
  if(text.length>12000000)fail(413,'记录超过12MB，请联系家长导出备份');
  try{return JSON.parse(text);}catch{fail(400,'JSON 无效');}
}
function publicAccount(a){return {id:a.id,name:a.name,kind:a.kind};}
function snapshot(a){return {account:publicAccount(a),revision:a.revision,bundle:a.bundle?JSON.parse(a.bundle):null,updatedAt:a.updated_at};}
async function validateBundle(db,bundle,account,deviceId,previous,migrate){
  try{S.validate(bundle);}catch(e){fail(400,e.message);}
  if(bundle.state.accountId!==account.id)fail(403,'账号与记录不匹配');
  const trusted=(await db.prepare('SELECT fingerprint,snapshot FROM questions').all()).results;
  const fingerprints=new Set(trusted.map(q=>q.fingerprint)),qs=new Map();
  for(const q of bundle.bank.questions){
    const fp=await digest(identity(q));
    if(!fingerprints.has(fp))fail(422,'题库版本尚未在服务器登记，请先更新正式题库');
    qs.set(q.id,{q,fp});
  }
  const known=new Map((previous?.state.history||[]).map(h=>[h.syncId,h]));
  for(const h of bundle.state.history){
    const prior=known.get(h.syncId),{q,fp}=qs.get(h.questionId)||{};
    if(!q||h.correct!==(h.selected===q.answer))fail(400,'作答与题目答案不一致');
    if(prior){
      if(JSON.stringify(prior)!==JSON.stringify(h))fail(409,'已同步的作答不能改写');
      known.delete(h.syncId);
    }else if(h.recordSource==='live'){
      if(h.accountId!==account.id||h.deviceId!==deviceId||!uuid.test(h.eventId||'')||
        h.syncId!=='event-'+h.eventId||h.fingerprint!==fp||
        !Number.isFinite(Date.parse(h.occurredAt))||Date.parse(h.occurredAt)>Date.now()+86400000)fail(400,'新作答来源无效');
    }else if(h.recordSource!=='imported')fail(400,'旧记录须标记为历史迁移');
  }
  if(known.size)fail(409,'同步不能删除已有作答，请合并云端记录后重试');
  // Imported rewards may add old cats, but cannot remove existing earned rewards.
  if(previous){
    for(const key of ['settlements','openings']){
      for(const value of previous.state.rewards?.[key]||[]){
        const match=bundle.state.rewards?.[key].find(x=>x.id===value.id);
        if(!match||JSON.stringify(match)!==JSON.stringify(value))fail(409,'同步不能移除已有星星或猫咪');
      }
    }
  }
  if(!migrate&&(bundle.state.rewards?.openings||[]).some(o=>!previous?.state.rewards?.openings.some(p=>p.id===o.id)))fail(409,'请通过云端宝箱领取新猫咪');
}
export async function handleAccounts(request,env){
  try{
    if(!env.LEARNING_DB||!env.LEARNING_ADMIN_TOKEN)fail(503,'云端账号尚未配置，本机记录保留');
    const db=env.LEARNING_DB,url=new URL(request.url),route=url.pathname.replace(/\/$/,'');
    if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)fail(403,'来源无效');
    const auth=request.headers.get('authorization')||'',now=new Date().toISOString();
    if(route==='/api/admin/accounts'){
      if(auth!=='Bearer '+env.LEARNING_ADMIN_TOKEN)fail(401,'管理凭据无效');
      if(request.method!=='GET')fail(405,'方法无效');
      const accounts=(await db.prepare('SELECT id,name,kind,revision,updated_at FROM accounts').all()).results;
      return json({accounts});
    }
    if(route==='/api/admin/account-code'){
      if(auth!=='Bearer '+env.LEARNING_ADMIN_TOKEN)fail(401,'管理凭据无效');
      if(request.method!=='POST')fail(405,'方法无效');
      const data=await read(request);
      if(!ACCOUNTS.some(a=>a.id===data.accountId))fail(404,'账号不存在');
      return json({accountId:data.accountId,code:await accountCode(env.LEARNING_ADMIN_TOKEN,data.accountId)});
    }
    if(route==='/api/admin/account-records'){
      if(auth!=='Bearer '+env.LEARNING_ADMIN_TOKEN)fail(401,'管理凭据无效');
      if(request.method!=='GET')fail(405,'方法无效');
      const id=url.searchParams.get('accountId');
      const account=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(id||'ella').first();
      if(!account)fail(404,'账号不存在');
      const bundle=account.bundle?JSON.parse(account.bundle):null;
      const approved=url.searchParams.get('generation')==='true';
      const records=(bundle?.state.history||[]).filter(h=>!approved||(account.kind==='learner'&&h.recordSource==='live'&&h.accountId===account.id));
      return json({account:publicAccount(account),revision:account.revision,records});
    }
    if(route==='/api/accounts/login'&&request.method==='POST'){
      const data=await read(request);
      const accountId=typeof data.accountId==='string'?data.accountId:'';
      const rateKey=await digest((request.headers.get('cf-connecting-ip')||'local')+'|'+accountId);
      const nowMs=Date.now();
      const rate=await db.prepare(`INSERT INTO account_login_limits(key,attempts,reset_at) VALUES(?,1,?)
        ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN reset_at<=? THEN 1 ELSE attempts+1 END,
        reset_at=CASE WHEN reset_at<=? THEN excluded.reset_at ELSE reset_at END RETURNING attempts,reset_at`)
        .bind(rateKey,nowMs+900000,nowMs,nowMs).first();
      if(rate.attempts>10)fail(429,'尝试次数较多，请15分钟后再试');
      const account=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(accountId).first();
      if(!account||typeof data.code!=='string'||account.code_hash!==await digest(data.code.trim())||!uuid.test(data.deviceId||''))fail(401,'账号或登录码不正确');
      const token=hex(crypto.getRandomValues(new Uint8Array(32)));
      const expiresAt=new Date(nowMs+180*86400000).toISOString();
      await db.prepare('INSERT INTO account_sessions(token_hash,account_id,device_id,created_at,expires_at) VALUES(?,?,?,?,?)')
        .bind(await digest(token),account.id,data.deviceId,now,expiresAt).run();
      return json({...snapshot(account),token,expiresAt});
    }
    const session=auth.startsWith('Bearer ')?await db.prepare('SELECT * FROM account_sessions WHERE token_hash=? AND expires_at>?').bind(await digest(auth.slice(7)),now).first():null;
    if(!session||session.device_id!==request.headers.get('x-device-id'))fail(401,'请重新输入账号登录码；本机记录仍保留');
    const account=await db.prepare('SELECT * FROM accounts WHERE id=?').bind(session.account_id).first();
    if(route==='/api/accounts/state'&&request.method==='GET')return json(snapshot(account));
    if(route==='/api/accounts/logout'&&request.method==='POST'){
      await db.prepare('DELETE FROM account_sessions WHERE token_hash=?').bind(session.token_hash).run();
      return json({loggedOut:true});
    }
    if((route==='/api/accounts/state'||route==='/api/accounts/open')&&request.method==='POST'){
      const data=await read(request);
      if(!uuid.test(data.operationId||'')||!Number.isSafeInteger(data.revision)||data.revision<0)fail(400,'同步版本或操作编号无效');
      const payloadHash=await digest(JSON.stringify(data));
      const previous=await db.prepare('SELECT * FROM account_operations WHERE account_id=? AND operation_id=?').bind(account.id,data.operationId).first();
      if(previous){
        if(previous.payload_hash!==payloadHash)fail(409,'重试的操作内容不一致');
        return json({...snapshot(account),result:previous.result?JSON.parse(previous.result):null});
      }
      if(data.revision!==account.revision)fail(409,'另一台设备刚刚同步，请合并后重试');
      let bundle,result=null;
      if(route==='/api/accounts/open'){
        if(!account.bundle)fail(409,'请先同步学习记录');
        bundle=JSON.parse(account.bundle);
        try{result=R.open(bundle.state,data.operationId,()=>crypto.getRandomValues(new Uint32Array(1))[0]/4294967296);}
        catch(e){fail(409,e.message);}
      }else{
        bundle=data.bundle;
        if(!bundle||typeof bundle!=='object')fail(400,'缺少学习记录');
        await validateBundle(db,bundle,account,session.device_id,account.bundle?JSON.parse(account.bundle):null,data.migrate===true);
      }
      const text=JSON.stringify(bundle);
      if(text.length>12000000)fail(413,'学习记录超过容量，请联系家长导出备份');
      const results=await db.batch([
        db.prepare('UPDATE accounts SET bundle=?,revision=revision+1,updated_at=?,last_operation=? WHERE id=? AND revision=?')
          .bind(text,now,data.operationId,account.id,data.revision),
        db.prepare(`INSERT OR IGNORE INTO account_operations(account_id,operation_id,payload_hash,result)
          SELECT id,?,?,? FROM accounts WHERE id=? AND last_operation=?`)
          .bind(data.operationId,payloadHash,result?JSON.stringify(result):null,account.id,data.operationId)
      ]);
      if(!results[0].meta.changes)fail(409,'另一台设备刚刚同步，请合并后重试');
      return json({...snapshot({...account,bundle:text,revision:account.revision+1,updated_at:now}),result});
    }
    fail(404,'接口不存在');
  }catch(error){return json({error:error.status?error.message:'云端暂时未能同步，本机记录仍保留'},error.status||503);}
}
