const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'),'utf8'));
require('../engine').validateBank(bank);
fs.writeFileSync(path.join(root,'bank.js'),'window.LESSON_BANK = '+JSON.stringify(bank,null,2)+';\n');
const crypto=require('node:crypto');
const audio=require('./audio-assets').prepareAudio(root,bank);
fs.writeFileSync(path.join(root,'audio-manifest.js'),audio.script);
const feedbackStore=JSON.parse(fs.readFileSync(path.join(root,'feedback-store.json'),'utf8'));
const formUrl=new URL(feedbackStore.formUrl);
if(formUrl.protocol!=='https:')throw new Error('Feedback form must use HTTPS');
const feedbackScript='window.REVIEW_FEEDBACK = '+JSON.stringify({formUrl:formUrl.href})+';\n';
fs.writeFileSync(path.join(root,'feedback-config.js'),feedbackScript);
const kittenFiles=new Map(['ginger','tuxedo','calico','gray','siamese','cream'].map(name=>{
  const file=`assets/kittens/${name}.webp`;
  return [file,fs.readFileSync(path.join(root,file))];
}));
const cats=JSON.parse(fs.readFileSync(path.join(root,'assets/cats/catalog.json'),'utf8'));
if(cats.length!==100||new Set(cats.map(c=>c.id)).size!==100)throw new Error('Need 100 unique cats');
const catFiles=new Map();
for(const [i,cat] of cats.entries()){
  if(cat.id!==`cat-${String(i+1).padStart(3,'0')}`||!cat.name||!cat.category)throw new Error('Invalid cat catalog');
  for(const field of ['art','thumb','shadow']){
    const name=cat[field];
    if(name!==`assets/cats/${cat.id}${field==='art'?'':field==='thumb'?'-thumb':'-shadow'}.webp`)throw new Error('Invalid cat image path');
    catFiles.set(name,fs.readFileSync(path.join(root,name)));
  }
}
const catScript='window.CAT_CATALOG = '+JSON.stringify(cats)+';\n';
fs.writeFileSync(path.join(root,'cat-catalog.js'),catScript);
const hash=crypto.createHash('sha256');
for(const name of ['index.html','style.css','cat-club.css','rewards.js','engine.js','storage.js','learning-sync.js','account-state.js','account-sync.js','app.js','audio-player.js','error-feedback.js','audio/manifest.json','question-bank.json','package.json','updates/index.html','updates/style.css','updates/app.js','updates/reports.json'])hash.update(fs.readFileSync(path.join(root,name)));
hash.update(catScript);
hash.update(feedbackScript);
for(const bytes of audio.files.values())hash.update(bytes);
for(const bytes of kittenFiles.values())hash.update(bytes);
for(const bytes of catFiles.values())hash.update(bytes);
const version={app:require('../package.json').version,bank:bank.revision,build:hash.digest('hex').slice(0,12),builtAt:new Date().toISOString()};
fs.writeFileSync(path.join(root,'version.js'),'window.REVIEW_VERSION = '+JSON.stringify(version)+';\n');
let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="style.css">',()=>'<style>'+fs.readFileSync(path.join(root,'style.css'),'utf8')+'</style>');
html=html.replace('<link rel="stylesheet" href="cat-club.css">',()=>'<style>'+fs.readFileSync(path.join(root,'cat-club.css'),'utf8')+'</style>');
for(const name of ['bank.js','cat-catalog.js','rewards.js','engine.js','storage.js','learning-sync.js','account-state.js','account-sync.js','version.js','audio-manifest.js','audio-player.js','feedback-config.js','error-feedback.js','app.js']) {
  let js=(name==='audio-manifest.js'?audio.standaloneScript:fs.readFileSync(path.join(root,name),'utf8')).replace(/<\/script/gi,'<\\/script');
  if(name==='app.js')for(const [file,bytes] of kittenFiles)js=js.replaceAll(file,`data:image/webp;base64,${bytes.toString('base64')}`);
  if(name==='cat-catalog.js')for(const [file,bytes] of catFiles)js=js.replaceAll(file,`data:image/webp;base64,${bytes.toString('base64')}`);
  html=html.replace(`<script src="${name}"></script>`,()=>`<script>${js}</script>`);
}
const standalone=path.basename(root)==='workspace'?path.join(root,'英语复习小站.html'):path.resolve(root,'../英语复习小站.html');
fs.writeFileSync(standalone,html);
const dist=path.join(root,'dist');
fs.rmSync(dist,{recursive:true,force:true});
fs.mkdirSync(dist,{recursive:true});
for(const name of ['index.html','style.css','cat-club.css','cat-catalog.js','rewards.js','bank.js','engine.js','storage.js','learning-sync.js','account-state.js','account-sync.js','version.js','audio-manifest.js','audio-player.js','feedback-config.js','error-feedback.js','app.js','question-bank.json','_headers','99e0d85e952f8d812c763271f7a246d3.txt']){
  fs.copyFileSync(path.join(root,name),path.join(dist,name));
}
fs.writeFileSync(path.join(dist,'_routes.json'),JSON.stringify({version:1,include:['/api/*'],exclude:[]}));
fs.mkdirSync(path.join(dist,'updates'));
for(const name of ['index.html','style.css','app.js','reports.json'])fs.copyFileSync(path.join(root,'updates',name),path.join(dist,'updates',name));
fs.mkdirSync(path.join(dist,'audio'));
fs.copyFileSync(path.join(root,'audio/manifest.json'),path.join(dist,'audio-manifest.json'));
for(const [name,bytes] of audio.files)fs.writeFileSync(path.join(dist,name),bytes);
fs.mkdirSync(path.join(dist,'assets/kittens'),{recursive:true});
for(const [name,bytes] of kittenFiles)fs.writeFileSync(path.join(dist,name),bytes);
fs.mkdirSync(path.join(dist,'assets/cats'),{recursive:true});
for(const [name,bytes] of catFiles)fs.writeFileSync(path.join(dist,name),bytes);
console.log(`Validated ${bank.questions.length} questions and ${cats.length} cats; standalone page built.`);
