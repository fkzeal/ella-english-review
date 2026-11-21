// Private operational state uses the existing D1 binding, never static assets.
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export async function handleMaintenance(request,env){
  try{
    if(!env.LEARNING_DB||!env.LEARNING_ADMIN_TOKEN)return json({error:'Not configured'},503);
    if(request.headers.get('authorization')!=='Bearer '+env.LEARNING_ADMIN_TOKEN)return json({error:'Unauthorized'},401);
    const url=new URL(request.url),route=url.pathname.split('/').at(-1),db=env.LEARNING_DB;
    const now=Date.now();
    if(request.method==='GET'){
      if(route==='receipts'){
        const rows=(await db.prepare('SELECT rowid,receipt FROM maintenance_receipts ORDER BY rowid DESC LIMIT 40').all()).results;
        return json({receipts:rows.map(r=>({sequence:r.rowid,...JSON.parse(r.receipt)}))});
      }
      if(route==='state'){
        const row=await db.prepare('SELECT revision,manifest FROM maintenance_head WHERE id=1').first();
        return json({revision:row.revision,manifest:row.manifest?JSON.parse(row.manifest):null});
      }
      if(route==='chunk'){
        const revision=url.searchParams.get('revision'),part=Number(url.searchParams.get('part'));
        if(!uuid.test(revision||'')||!Number.isInteger(part)||part<0||part>=512)return json({error:'Invalid chunk'},400);
        const row=await db.prepare('SELECT content FROM maintenance_chunks WHERE revision=? AND part=?').bind(revision,part).first();
        return row?json(row):json({error:'Not found'},404);
      }
      if(route==='receipt'){
        const row=await db.prepare('SELECT receipt FROM maintenance_receipts WHERE run_id=?').bind(url.searchParams.get('run')||'').first();
        return row?json(JSON.parse(row.receipt)):json({error:'Not found'},404);
      }
      return json({error:'Not found'},404);
    }
    if(request.method!=='POST')return json({error:'Method not allowed'},405);
    if(request.headers.get('origin')!==url.origin)return json({error:'Invalid origin'},403);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'JSON required'},415);
    const text=await request.text();
    if(text.length>100000)return json({error:'Too large'},413);
    const data=JSON.parse(text);
    if(route==='receipt'){
      if(!uuid.test(data.runId||'')||JSON.stringify(data).length>50000)return json({error:'Invalid receipt'},400);
      // First receipt wins: a later session cannot silently rewrite the evidence.
      await db.prepare('INSERT OR IGNORE INTO maintenance_receipts VALUES(?,?)').bind(data.runId,JSON.stringify(data)).run();
      return json({saved:true});
    }
    if(!uuid.test(data.owner||''))return json({error:'Invalid owner'},400);
    if(route==='lease'){
      const until=data.release?0:now+300000;
      const result=await db.prepare(`UPDATE maintenance_head SET lease_owner=?,lease_until=?
        WHERE id=1 AND (lease_owner=? OR lease_until<?)`).bind(data.release?null:data.owner,until,data.owner,now).run();
      return json({acquired:result.meta.changes===1,until},result.meta.changes===1?200:409);
    }
    if(!uuid.test(data.revision||''))return json({error:'Invalid revision'},400);
    if(route==='chunk'){
      if(!Number.isInteger(data.part)||data.part<0||data.part>=512||typeof data.content!=='string'||
        data.content.length>64000||!data.content.length||!/^[A-Za-z0-9+/=]+$/.test(data.content))return json({error:'Invalid chunk'},400);
      const result=await db.prepare(`INSERT OR IGNORE INTO maintenance_chunks(revision,part,content)
        SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM maintenance_head WHERE id=1 AND lease_owner=? AND lease_until>?)
        AND ? != COALESCE((SELECT revision FROM maintenance_head WHERE id=1),'')`).bind(data.revision,data.part,data.content,data.owner,now,data.revision).run();
      return json({saved:result.meta.changes===1},result.meta.changes===1?200:409);
    }
    if(route==='commit'){
      const m=data.manifest;
      if(!m||m.version!==1||!Number.isInteger(m.chunks)||m.chunks<1||m.chunks>512||
        !/^[a-f0-9]{64}$/.test(m.sha256||'')||!Number.isInteger(m.bytes)||m.bytes<1||m.bytes>32768000||
        (data.expected!==null&&!uuid.test(data.expected||'')))return json({error:'Invalid manifest'},400);
      const result=await db.prepare(`UPDATE maintenance_head SET revision=?,manifest=?
        WHERE id=1 AND lease_owner=? AND lease_until>? AND revision IS ?
        AND (SELECT COUNT(*) FROM maintenance_chunks WHERE revision=?)=?
        AND (SELECT MIN(part) FROM maintenance_chunks WHERE revision=?)=0
        AND (SELECT MAX(part) FROM maintenance_chunks WHERE revision=?)=?`).bind(
          data.revision,JSON.stringify(m),data.owner,now,data.expected,data.revision,m.chunks,data.revision,data.revision,m.chunks-1).run();
      if(result.meta.changes===1)try{
        // Retain the current and previous snapshot, not an unbounded daily log.
        await db.prepare(`DELETE FROM maintenance_chunks WHERE revision<>? AND revision<>?
          AND EXISTS(SELECT 1 FROM maintenance_head WHERE id=1 AND revision=? AND lease_owner=? AND lease_until>?)`)
          .bind(data.revision,data.expected||'',data.revision,data.owner,Date.now()).run();
      }catch{/* Cleanup can be retried; the atomic commit already succeeded. */}
      return json({committed:result.meta.changes===1},result.meta.changes===1?200:409);
    }
    return json({error:'Not found'},404);
  }catch(error){return json({error:error instanceof SyntaxError?'Invalid JSON':'State service unavailable'},error instanceof SyntaxError?400:503);}
}
