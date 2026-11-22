import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,randomBytes,hkdfSync,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {fetchJson} from './http-json.mjs';
import {orderedTransfer} from './ordered-transfer.mjs';
const base='https://ella-english-review.pages.dev';
const prefixes=['.course-imports/','.error-feedback/','operations/'];
const names=['path-map.json','local-task-disabled.confirmed','handoff/Ella-22点30自动化任务-云端交接.md'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const allowed=name=>typeof name==='string'&&!name.includes('\\')&&!name.split('/').some(s=>s==='..'||s==='.'||!s)&&
  (names.includes(name)||prefixes.some(p=>name.startsWith(p)));
export function pack(directory){
  const files=[];
  function walk(dir){
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,item.name),name=path.relative(directory,file).split(path.sep).join('/');
      if(item.isSymbolicLink())throw new Error('Symlinks forbidden in private state');
      if(item.isDirectory())walk(file);
      else if(allowed(name)){
        const bytes=fs.readFileSync(file);
        files.push({path:name,sha256:sha(bytes),data:bytes.toString('base64')});
      }
    }
  }
  for(const prefix of prefixes)if(fs.existsSync(path.join(directory,prefix)))walk(path.join(directory,prefix));
  for(const name of names)if(fs.existsSync(path.join(directory,name))){
    const bytes=fs.readFileSync(path.join(directory,name));
    files.push({path:name,sha256:sha(bytes),data:bytes.toString('base64')});
  }
  validate(files);
  return {version:1,files};
}
function validate(files){
  if(!Array.isArray(files)||files.length>10000)throw new Error('Invalid state archive');
  const map=new Map();
  for(const f of files){
    if(!allowed(f.path)||map.has(f.path)||typeof f.data!=='string'||!/^[A-Za-z0-9+/=]*$/.test(f.data)||
      sha(Buffer.from(f.data,'base64'))!==f.sha256)throw new Error('Unsafe or corrupt state archive');
    map.set(f.path,Buffer.from(f.data,'base64'));
  }
  if(!map.has('local-task-disabled.confirmed')||!map.has('path-map.json')||
    !map.has('handoff/Ella-22点30自动化任务-云端交接.md')||!map.has('.error-feedback/scan.json'))
    throw new Error('Required authoritative state missing; never initialize empty');
  const ledger=JSON.parse(map.get('.course-imports/ledger.json')||'null');
  if(ledger?.version!==1||ledger.documentUrl!=='https://dcar.feishu.cn/docx/RhNgdppuWoKp6kxjE24cOwjfnwh'||
    !ledger.media||!Object.keys(ledger.media).length)throw new Error('Invalid materials ledger');
  for(const entry of Object.values(ledger.media)){
    if(entry.status==='published'){
      const bytes=map.get('.course-imports/media/'+path.basename(entry.localPath||''));
      if(!bytes||sha(bytes)!==entry.sha256)throw new Error('Published image evidence missing or corrupt');
    }
  }
  return map;
}
export function encrypt(archive,token){
  const key=Buffer.from(hkdfSync('sha256',token,'ella-maintenance-state-v1','private-archive',32));
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  const ciphertext=Buffer.concat([cipher.update(gzipSync(JSON.stringify(archive))),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64');
}
export function decrypt(content,token){
  const bytes=Buffer.from(content,'base64');
  const key=Buffer.from(hkdfSync('sha256',token,'ella-maintenance-state-v1','private-archive',32));
  const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));
  const archive=JSON.parse(gunzipSync(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]),{maxOutputLength:64000000}));
  if(archive.version!==1)throw new Error('Unsupported state format');
  validate(archive.files);return archive;
}
export function unpack(archive,directory){
  const files=validate(archive.files);
  if(fs.existsSync(directory))throw new Error('Restore destination already exists; preserve local state');
  const temporary=directory+'.restore-'+randomUUID();
  fs.mkdirSync(temporary,{recursive:true,mode:0o700});
  try{
    for(const [name,bytes] of files){
      const file=path.join(temporary,name);
      fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
      fs.writeFileSync(file,bytes,{mode:0o600,flag:'wx'});
    }
    fs.renameSync(temporary,directory);
  }catch(error){fs.rmSync(temporary,{recursive:true,force:true});throw error;}
  return files.size;
}
export async function api(route,data){
  const token=process.env.LEARNING_ADMIN_TOKEN;
  if(!token)throw new Error('LEARNING_ADMIN_TOKEN missing');
  const r=await fetchJson(base+'/api/admin/maintenance/'+route,{
    method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,Origin:base,'Content-Type':'application/json'},
    ...(data?{body:JSON.stringify(data)}:{})});
  // A response lost after persistence may be retried safely with identical data.
  if(r.status===409&&data&&route==='chunk'){
    const previous=await api('chunk?revision='+data.revision+'&part='+data.part);
    if(previous.content===data.content)return {saved:true};
  }
  if(r.status===409&&data&&route==='commit'){
    const head=await api('state');
    if(head.revision===data.revision&&JSON.stringify(head.manifest)===JSON.stringify(data.manifest))return {committed:true};
  }
  if(!r.ok)throw new Error('Private state '+route.split('?')[0]+': HTTP '+r.status);
  return r.body;
}
export async function save(directory,expected,owner){
  const content=encrypt(pack(directory),process.env.LEARNING_ADMIN_TOKEN),revision=randomUUID();
  const chunks=content.match(/.{1,64000}/g);
  if(chunks.length>512)throw new Error('State archive exceeds size limit');
  await api('lease',{owner});
  await orderedTransfer(chunks,async(value,part)=>api('chunk',{owner,revision,part,content:value}));
  await api('lease',{owner});
  await api('commit',{owner,revision,expected,manifest:{version:1,chunks:chunks.length,bytes:content.length,sha256:sha(content)}});
  return revision;
}
export async function restore(directory){
  const {revision,manifest}=await api('state');
  if(!revision||!manifest)throw new Error('Authoritative cloud state missing; refuse empty initialization');
  const parts=await orderedTransfer(Array.from({length:manifest.chunks},(_,part)=>part),
    async part=>(await api('chunk?revision='+revision+'&part='+part)).content);
  const content=parts.join('');
  if(content.length!==manifest.bytes||sha(content)!==manifest.sha256)throw new Error('Remote archive corrupt');
  const files=unpack(decrypt(content,process.env.LEARNING_ADMIN_TOKEN),directory);
  return {revision,files};
}
async function main(){
  process.umask(0o077);
  const [command,directory,extra]=process.argv.slice(2);
  if(command==='seed'){
    const head=await api('state');
    if(head.revision)throw new Error('Cloud state already seeded; refuse overwrite');
    const owner=randomUUID();await api('lease',{owner});
    try{console.log(JSON.stringify({revision:await save(directory,null,owner)}));}
    finally{await api('lease',{owner,release:true});}
    return;
  }
  if(command==='restore'){console.log(JSON.stringify(await restore(directory)));return;}
  if(command==='save'){
    const session=JSON.parse(fs.readFileSync(extra));
    await api('lease',{owner:session.owner});
    session.revision=await save(directory,session.revision,session.owner);
    fs.writeFileSync(extra,JSON.stringify(session),{mode:0o600});
    console.log(JSON.stringify({saved:true,revision:session.revision}));return;
  }
  if(command==='release'){
    const session=JSON.parse(fs.readFileSync(directory));
    fs.writeFileSync(directory+'.stop','',{mode:0o600});
    await api('lease',{owner:session.owner,release:true});return;
  }
  throw new Error('Expected seed/restore/save/release');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(()=>{console.error('Private state operation failed; credentials and archive contents suppressed.');process.exitCode=1;});
}
