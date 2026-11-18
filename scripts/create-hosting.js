const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const name=fs.readFileSync(path.join(root,'wrangler.toml'),'utf8').match(/^name\s*=\s*"([a-z0-9-]+)"/m)?.[1];
if(!name){console.error('Missing fixed Pages project name');process.exit(1);}
const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
const result=spawnSync(process.execPath,[cli,'pages','project','create',name,'--production-branch','main'],{cwd:root,env:process.env,stdio:'inherit'});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
