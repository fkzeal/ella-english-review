const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'),'utf8'));
require('../engine').validateBank(bank);
fs.writeFileSync(path.join(root,'bank.js'),'window.LESSON_BANK = '+JSON.stringify(bank,null,2)+';\n');
const crypto=require('node:crypto');
const audio=require('./audio-assets').prepareAudio(root,bank);
fs.writeFileSync(path.join(root,'audio-manifest.js'),audio.script);
const hash=crypto.createHash('sha256');
for(const name of ['index.html','style.css','engine.js','storage.js','app.js','audio-player.js','audio/manifest.json','question-bank.json','package.json'])hash.update(fs.readFileSync(path.join(root,name)));
for(const bytes of audio.files.values())hash.update(bytes);
const version={app:require('../package.json').version,bank:bank.revision,build:hash.digest('hex').slice(0,12),builtAt:new Date().toISOString()};
fs.writeFileSync(path.join(root,'version.js'),'window.REVIEW_VERSION = '+JSON.stringify(version)+';\n');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+fs.readFileSync(path.join(root,'style.css'),'utf8')+'</style>');
for(const name of ['bank.js','engine.js','storage.js','version.js','audio-manifest.js','audio-player.js','app.js']) {
  const js=(name==='audio-manifest.js'?audio.standaloneScript:fs.readFileSync(path.join(root,name),'utf8')).replace(/<\/script/gi,'<\\/script');
  html=html.replace(`<script src="${name}"></script>`,()=>`<script>${js}</script>`);
}
const standalone=path.basename(root)==='workspace'?path.join(root,'英语复习小站.html'):path.resolve(root,'../英语复习小站.html');
fs.writeFileSync(standalone,html);
const dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(dist,{recursive:true});
for(const name of ['index.html','style.css','bank.js','engine.js','storage.js','version.js','audio-manifest.js','audio-player.js','app.js','question-bank.json','_headers','99e0d85e952f8d812c763271f7a246d3.txt']){
  fs.copyFileSync(path.join(root,name),path.join(dist,name));
}
fs.mkdirSync(path.join(dist,'audio'));
for(const [name,bytes] of audio.files)fs.writeFileSync(path.join(dist,name),bytes);
console.log(`Validated ${bank.questions.length} questions; standalone page built.`);
