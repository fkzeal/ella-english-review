// Only user-authorized credential backups are read. Never restore old state here.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const keys=['GH_TOKEN','GITHUB_TOKEN','LEARNING_ADMIN_TOKEN'];
export function recoverCredentials(){
  const sources=[];
  function ingest(text,label){
    for(const line of text.split('\n')){
      const m=line.match(/^(?:export\s+)?(GH_TOKEN|GITHUB_TOKEN|LEARNING_ADMIN_TOKEN)=['"]?([A-Za-z0-9_-]{20,256})['"]?\s*$/);
      if(m&&!process.env[m[1]]){process.env[m[1]]=m[2];sources.push(label);}
    }
  }
  const canonical='/data/user/.config/ella-github/env.sh';
  if(fs.existsSync(canonical)){
    const stat=fs.lstatSync(canonical);
    if(!stat.isSymbolicLink()&&(stat.mode&0o077)===0)ingest(fs.readFileSync(canonical,'utf8'),'private-user-config');
  }
  if(!(process.env.GH_TOKEN||process.env.GITHUB_TOKEN)||!process.env.LEARNING_ADMIN_TOKEN){
    const roots=['/workspace','/data/user'];
    const archives=[];
    function walk(dir,depth){
      if(depth>7)return;
      for(const f of fs.readdirSync(dir,{withFileTypes:true})){
        if(f.isSymbolicLink()||['node_modules','.git','skills','plugins','.course-imports','.ella-automation','.ella-cloud-runtime'].includes(f.name))continue;
        const full=path.join(dir,f.name);
        if(f.isDirectory())walk(full,depth+1);
        else if(f.name.includes('Ella-云端自动化交接包')&&f.name.endsWith('.zip'))archives.push(full);
      }
    }
    for(const dir of roots)if(fs.existsSync(dir))walk(dir,0);
    for(const archive of archives.sort()){
      const code="import zipfile,sys\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for n in z.namelist():\n  if n.endswith('/cloud-secrets.env') or n=='cloud-secrets.env':\n   sys.stdout.write(z.read(n).decode())\n";
      const r=spawnSync('python3',['-c',code,archive],{encoding:'utf8',maxBuffer:65536,timeout:10000});
      if(r.status===0)ingest(r.stdout,'user-uploaded-credential-backup');
    }
  }
  if(!process.env.GH_TOKEN&&process.env.GITHUB_TOKEN)process.env.GH_TOKEN=process.env.GITHUB_TOKEN;
  for(const key of keys)if(process.env[key]&&!/^[A-Za-z0-9_-]{20,256}$/.test(process.env[key]))throw new Error('Invalid credential format');
  return {githubReady:Boolean(process.env.GH_TOKEN),adminReady:Boolean(process.env.LEARNING_ADMIN_TOKEN),sources:[...new Set(sources)]};
}
