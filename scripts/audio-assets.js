const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function prepareAudio(root,bank){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'audio/manifest.json'),'utf8'));
  if(!manifest.demoText||!manifest.clips)throw new Error('Missing listening manifest');
  const texts=[manifest.demoText,...bank.questions.filter(q=>q.active!==false&&q.type==='listening').map(q=>q.audioText)];
  const files=new Map(),standalone=structuredClone(manifest);
  for(const text of texts){
    const clip=manifest.clips[text];
    if(!clip||!/^audio\/[a-f0-9]{24}\.mp3$/.test(clip.file))throw new Error(`Missing listening clip: ${text}`);
    const bytes=fs.readFileSync(path.join(root,clip.file));
    if(bytes.length<1000||crypto.createHash('sha256').update(bytes).digest('hex')!==clip.sha256)throw new Error(`Invalid listening clip: ${clip.file}`);
    files.set(clip.file,bytes);
    standalone.clips[text].file='data:audio/mpeg;base64,'+bytes.toString('base64');
  }
  return {manifest,files,script:'window.LESSON_AUDIO = '+JSON.stringify(manifest)+';\n',
    standaloneScript:'window.LESSON_AUDIO = '+JSON.stringify(standalone)+';\n'};
}
module.exports={prepareAudio};
