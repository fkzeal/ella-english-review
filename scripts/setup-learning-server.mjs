import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {digest,questionIdentity} from '../learning-server.mjs';
import {accountSeeds} from '../account-server.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
const admin=process.env.LEARNING_ADMIN_TOKEN;
if(!account||!token||!admin||admin.length<40)throw new Error('需要 Cloudflare 凭据和至少40字符的私有 LEARNING_ADMIN_TOKEN');
async function api(route,method='GET',data){
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/${route}`,{
    method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});
  const result=await response.json();
  if(!response.ok||!result.success){
    // Print codes only: never dump response headers, credentials or device data.
    throw new Error(`Cloudflare ${method} ${route}: HTTP ${response.status}, codes ${(result.errors||[]).map(e=>e.code).join(',')}. 数据库需 Account D1 Edit，网站绑定需 Cloudflare Pages Edit 权限。`);
  }
  return result;
}
const databaseName='ella-learning-records';
const matches=[];
for(let page=1;page<=100;page++){
  const result=await api(`d1/database?name=${databaseName}&per_page=100&page=${page}`);
  matches.push(...result.result.filter(db=>db.name===databaseName));
  if(result.result.length<100)break;
}
if(matches.length>1)throw new Error('存在重复同名数据库，停止配置以保护数据');
let database=matches[0];
if(!database)database=(await api('d1/database','POST',{name:databaseName})).result;
if(!database?.uuid)throw new Error('数据库未返回有效 UUID');
const config=fs.readFileSync(path.join(root,'wrangler.toml'),'utf8')+
  `\n[[d1_databases]]\nbinding = "LEARNING_DB"\ndatabase_name = "${databaseName}"\ndatabase_id = "${database.uuid}"\n`;
fs.writeFileSync(path.join(root,'wrangler.learning.toml'),config);
const dir=path.join(root,'.learning-server');fs.mkdirSync(dir,{recursive:true,mode:0o700});
const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'),'utf8'));
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const inserts=[];
for(const a of await accountSeeds(admin))inserts.push(`INSERT OR IGNORE INTO accounts(id,name,kind,code_hash) VALUES(${quote(a.id)},${quote(a.name)},${quote(a.kind)},${quote(a.codeHash)});`);
for(const q of bank.questions){
  const p=bank.points.find(p=>p.id===q.pointId),lesson=bank.lessons.find(l=>l.id===p.lessonId);
  const snapshot={...q,lessonId:p.lessonId,pointTitle:p.title,pointEvidence:p.evidence,lessonTitle:lesson.title,revision:bank.revision};
  inserts.push(`INSERT OR IGNORE INTO questions(fingerprint,question_id,revision,snapshot) VALUES(${quote(await digest(questionIdentity(q)))},${quote(q.id)},${bank.revision},${quote(JSON.stringify(snapshot))});`);
}
const sqlFile=path.join(dir,'seed.sql');
const migrations=fs.readdirSync(path.join(root,'migrations')).filter(n=>n.endsWith('.sql')).sort().map(n=>fs.readFileSync(path.join(root,'migrations',n),'utf8')).join('\n');
fs.writeFileSync(sqlFile,migrations+'\n'+inserts.join('\n'),{mode:0o600});
const result=spawnSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute',databaseName,'--remote','--config','wrangler.learning.toml','--file',sqlFile,'--yes'],{cwd:root,env:process.env,stdio:'inherit'});
if(result.status!==0)throw new Error('数据库初始化未完成，停止发布');
const project=(await api('pages/projects/ella-english-review')).result;
const deployments={...project.deployment_configs};
// Keep previews read-only by leaving all learning bindings out of preview.
const production=deployments.production||{};
deployments.production={...production,d1_databases:{...production.d1_databases,LEARNING_DB:{id:database.uuid}},
  env_vars:{...production.env_vars,LEARNING_ADMIN_TOKEN:{type:'secret_text',value:admin}}};
await api('pages/projects/ella-english-review','PATCH',{deployment_configs:deployments});
console.log('Private learning database initialized and production binding configured.');
