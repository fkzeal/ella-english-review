const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function run(file,args){
  const result=spawnSync(process.execPath,[file,...args],{cwd:root,env:process.env,stdio:'inherit'});
  if(result.error){console.error(result.error.message);process.exit(1);}
  if(result.status!==0)process.exit(result.status||1);
}
// Always validate content and rebuild before updating the same production project.
run('--test',fs.readdirSync(path.join(root,'tests')).filter(name=>name.endsWith('.test.js')).map(name=>'tests/'+name));
run(path.join(root,'scripts/build.js'),[]);
run(path.join(root,'scripts/setup-learning-server.mjs'),[]);
const config=fs.readFileSync(path.join(root,'wrangler.toml'),'utf8');
const name=config.match(/^name\s*=\s*"([a-z0-9-]+)"/m)?.[1];
if(!name){console.error('Missing fixed Pages project name');process.exit(1);}
const cli=path.join(root,'node_modules/wrangler/bin/wrangler.js');
if(!fs.existsSync(cli)){console.error('Run npm ci before deploying');process.exit(1);}
run(cli,['pages','deploy','dist','--project-name',name,'--branch','main','--config','wrangler.learning.toml']);
