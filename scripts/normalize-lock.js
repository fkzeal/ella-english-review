const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const target=path.join(root,'package-lock.json');
const lock=JSON.parse(fs.readFileSync(target,'utf8'));
lock.version=pkg.version;
if(lock.packages[''])lock.packages[''].version=pkg.version;
let changed=0;
for(const entry of Object.values(lock.packages)){
  if(entry.resolved?.startsWith('https://bnpm.byted.org/')){
    entry.resolved=entry.resolved.replace('https://bnpm.byted.org/','https://registry.npmjs.org/');
    changed++;
  }
}
fs.writeFileSync(target,JSON.stringify(lock,null,2)+'\n');
console.log(`Aligned version and normalized ${changed} tarball URLs for public CI.`);
