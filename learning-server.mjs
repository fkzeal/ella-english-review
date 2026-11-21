// Only /api/* is routed here. Learning records never enter the static build.
const encoder=new TextEncoder();
export async function digest(value){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export function questionIdentity(q){
  return JSON.stringify([q.id,q.pointId,q.reviewUnit||null,q.learningTarget||null,q.type,q.prompt,q.passage||null,q.audioText||null,q.options,q.answer,q.active!==false]);
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=/^[0-9a-f]{64}$/;
function fail(status,message){throw Object.assign(new Error(message),{status});}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
async function body(request){
  if(!request.headers.get('content-type')?.startsWith('application/json'))fail(415,'需要 JSON');
  if(Number(request.headers.get('content-length')||0)>100000)fail(413,'请求过大');
  const text=await request.text();if(text.length>100000)fail(413,'请求过大');
  try{return JSON.parse(text);}catch{fail(400,'JSON 无效');}
}
async function signedToken(secret,id,enrollment){
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(id+':'+enrollment)))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
export async function handle(request,env){
  try{
    const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
    if(!env.LEARNING_DB||!env.LEARNING_ADMIN_TOKEN)fail(503,'服务器记录尚未配置，本地记录不受影响');
    const db=env.LEARNING_DB,now=new Date().toISOString();
    // No cross-origin writes, including local files and preview installations.
    if(request.method!=='GET'&&request.headers.get('origin')!==url.origin)fail(403,'来源无效');
    const auth=request.headers.get('authorization')||'';
    if(path==='/api/health'&&request.method==='GET'){
      await db.prepare('SELECT id FROM devices LIMIT 1').all();return json({ready:true});
    }
    if(path==='/api/register'&&request.method==='POST'){
      const data=await body(request);
      if(!uuid.test(data.deviceId||'')||!hex.test(data.enrollment||''))fail(400,'设备登记无效');
      const enrollmentHash=await digest(data.enrollment);
      const existing=await db.prepare('SELECT enrollment_hash FROM devices WHERE id=?').bind(data.deviceId).first();
      if(existing&&existing.enrollment_hash!==enrollmentHash)fail(409,'设备身份冲突');
      const token=await signedToken(env.LEARNING_ADMIN_TOKEN,data.deviceId,data.enrollment);
      await db.prepare(`INSERT INTO devices(id,enrollment_hash,token_hash,created_at,last_seen) VALUES(?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET last_seen=excluded.last_seen,token_hash=excluded.token_hash
        WHERE devices.enrollment_hash=excluded.enrollment_hash`).bind(data.deviceId,enrollmentHash,await digest(token),now,now).run();
      const registered=await db.prepare('SELECT token_hash FROM devices WHERE id=?').bind(data.deviceId).first();
      if(registered.token_hash!==await digest(token))fail(409,'设备身份冲突');
      return json({deviceId:data.deviceId,token});
    }
    if(path.startsWith('/api/admin/')){
      if(auth!=='Bearer '+env.LEARNING_ADMIN_TOKEN)fail(401,'管理凭据无效');
      if(path==='/api/admin/devices'&&request.method==='GET'){
        const result=await db.prepare(`SELECT d.id,d.name,d.approved,d.created_at,d.last_seen,
          COUNT(a.event_id) AS answerCount,
          COALESCE(SUM(a.correct=0),0) AS wrongCount,
          COUNT(DISTINCT CASE WHEN a.correct=0 THEN a.fingerprint END) AS wrongQuestionCount,
          COALESCE(SUM(a.source='live'),0) AS liveCount,
          COALESCE(SUM(a.source='backfill'),0) AS backfillCount,
          COALESCE(SUM(a.source='imported'),0) AS importedCount
          FROM devices d LEFT JOIN answers a ON a.device_id=d.id GROUP BY d.id ORDER BY d.created_at`).all();
        return json({devices:result.results});
      }
      if(path==='/api/admin/device'&&request.method==='POST'){
        const data=await body(request);
        if(!uuid.test(data.deviceId||'')||typeof data.approved!=='boolean'||typeof data.name!=='string'||data.name.length>40)fail(400,'设备设置无效');
        const result=await db.prepare('UPDATE devices SET name=?,approved=? WHERE id=?').bind(data.name,data.approved?1:0,data.deviceId).run();
        if(!result.meta.changes)fail(404,'设备不存在');return json({updated:true});
      }
      if(path==='/api/admin/records'&&request.method==='GET'){
        const id=url.searchParams.get('deviceId'),approvedOnly=url.searchParams.get('approvedOnly')==='true';
        if(!id&&!approvedOnly)fail(400,'指定设备或 approvedOnly=true');
        if(id&&!uuid.test(id))fail(400,'设备无效');
        const limit=Math.max(1,Math.min(500,Number(url.searchParams.get('limit'))||200));
        const cursor=url.searchParams.get('cursor')||'',after=url.searchParams.get('after')||'';
        const result=await db.prepare(`SELECT a.*,q.snapshot,d.name,d.approved
          FROM answers a JOIN questions q ON q.fingerprint=a.fingerprint JOIN devices d ON d.id=a.device_id
          WHERE (?='' OR a.device_id=?) AND (?=0 OR (d.approved=1 AND a.source='live'))
          AND a.received_at>=? AND (a.received_at || '|' || a.device_id || '|' || a.event_id)>?
          ORDER BY a.received_at,a.device_id,a.event_id LIMIT ?`).bind(id||'',id||'',approvedOnly?1:0,after,cursor,limit+1).all();
        const rows=result.results.slice(0,limit);
        return json({records:rows.map(({snapshot,payload_hash,...row})=>({...row,question:JSON.parse(snapshot)})),
          nextCursor:result.results.length>limit?(()=>{const r=rows.at(-1);return r.received_at+'|'+r.device_id+'|'+r.event_id;})():null});
      }
      fail(404,'接口不存在');
    }
    const id=request.headers.get('x-device-id');
    if(!uuid.test(id||''))fail(401,'设备凭据缺失');
    const device=await db.prepare('SELECT * FROM devices WHERE id=?').bind(id).first();
    if(!device||!auth.startsWith('Bearer ')||device.token_hash!==await digest(auth.slice(7)))fail(401,'设备凭据无效');
    if(path==='/api/device'&&request.method==='GET'){
      const stats=await db.prepare('SELECT COUNT(*) AS answerCount,COALESCE(SUM(correct=0),0) AS wrongCount FROM answers WHERE device_id=?').bind(id).first();
      return json({deviceId:id,name:device.name,approved:Boolean(device.approved),...stats});
    }
    if(path==='/api/events'&&request.method==='POST'){
      const data=await body(request);
      if(!Array.isArray(data.events)||!data.events.length||data.events.length>100)fail(400,'每次上传 1–100 条记录');
      const statements=[],acknowledged=[],seen=new Map();
      for(const e of data.events){
        if(!e||typeof e.eventId!=='string'||!(/^[0-9a-f-]{36}$/.test(e.eventId)||/^backfill-[0-9a-f]{64}$/.test(e.eventId))||
          !hex.test(e.fingerprint||'')||!validDate(e.day)||typeof e.help!=='boolean'||!Number.isInteger(e.selected)||
          !['live','backfill','imported'].includes(e.source)||typeof e.occurredAt!=='string'||
          !Number.isFinite(Date.parse(e.occurredAt))||Date.parse(e.occurredAt)>Date.now()+86400000||
          Date.parse(e.occurredAt)<Date.parse('2020-01-01')||
          (e.originDeviceId!==null&&e.originDeviceId!==undefined&&!uuid.test(e.originDeviceId)))fail(400,'作答事件无效');
        const question=await db.prepare('SELECT * FROM questions WHERE fingerprint=?').bind(e.fingerprint).first();
        if(!question)fail(422,'题目版本未在服务器登记');
        const q=JSON.parse(question.snapshot);
        if(e.questionId!==q.id||e.selected<0||e.selected>=q.options.length)fail(400,'题目或答案无效');
        const canonical=JSON.stringify([e.questionId,e.fingerprint,e.day,e.occurredAt,e.selected,e.help,e.source,e.originDeviceId||null]);
        const payloadHash=await digest(canonical);
        if(seen.has(e.eventId)&&seen.get(e.eventId)!==payloadHash)fail(409,'重复事件内容不一致');seen.set(e.eventId,payloadHash);
        const existing=await db.prepare('SELECT payload_hash FROM answers WHERE device_id=? AND event_id=?').bind(id,e.eventId).first();
        if(existing&&existing.payload_hash!==payloadHash)fail(409,'重复事件内容不一致');
        statements.push(db.prepare(`INSERT OR IGNORE INTO answers
          (device_id,event_id,occurred_at,received_at,learning_day,fingerprint,selected,correct,help,source,origin_device_id,payload_hash)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,e.eventId,e.occurredAt,now,e.day,e.fingerprint,e.selected,e.selected===q.answer?1:0,e.help?1:0,e.source,e.originDeviceId||null,payloadHash));
        acknowledged.push(e.eventId);
      }
      statements.push(db.prepare('UPDATE devices SET last_seen=? WHERE id=?').bind(now,id));
      await db.batch(statements);
      // Recheck after the transaction to catch conflicting simultaneous retries.
      for(const [eventId,hash] of seen){
        const row=await db.prepare('SELECT payload_hash FROM answers WHERE device_id=? AND event_id=?').bind(id,eventId).first();
        if(row?.payload_hash!==hash)fail(409,'重复事件内容不一致');
      }
      return json({acknowledged,syncedAt:now});
    }
    fail(404,'接口不存在');
  }catch(error){return json({error:error.status?error.message:'服务器暂时未能保存，请稍后重试'},error.status||503);}
}
