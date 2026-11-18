const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const A=require('../audio-player'),{prepareAudio}=require('../scripts/audio-assets');
const bank=require('../question-bank.json'),manifest=require('../audio/manifest.json');
function harness({voices=[],reject,clip=true}={}){
  const media=[],spoken=[],timers=new Map(),listeners=new Map();let seq=0;
  const env={
    setTimeout(fn,ms){timers.set(++seq,{fn,ms});return seq;},clearTimeout(id){timers.delete(id);},
    Audio:class{
      constructor(src){this.src=src;media.push(this);}
      play(){return reject?Promise.reject(reject):Promise.resolve();}
      pause(){this.paused=true;}
      removeAttribute(){this.src='';}load(){}
    },
    SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},
    speechSynthesis:{getVoices:()=>voices,speak:u=>spoken.push(u),cancel(){},
      addEventListener:(event,fn)=>listeners.set(event,fn),removeEventListener:event=>listeners.delete(event)}
  };
  const player=A.create(env,clip?manifest:{clips:{}}),messages=[];
  return {env,player,media,spoken,timers,listeners,messages,voices,
    play:(text=manifest.demoText,slow=false)=>player.play(text,{slow,tell:s=>messages.push(s)}),
    tick(ms){for(const [id,t] of [...timers])if(t.ms===ms){timers.delete(id);t.fn();}}};
}
test('every current listening script has a checksum-verified clip and offline embedding',()=>{
  const audio=prepareAudio(path.resolve(__dirname,'..'),bank);
  assert.equal(audio.files.size,16);
  for(const q of bank.questions.filter(q=>q.type==='listening')){
    assert(audio.manifest.clips[q.audioText]);
  }
  assert.match(audio.standaloneScript,/data:audio\/mpeg;base64,/);
});
test('missing or damaged audio prevents publishing',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ella-audio-test-'));
  try{
    fs.mkdirSync(path.join(tmp,'audio'));
    fs.writeFileSync(path.join(tmp,'audio/manifest.json'),JSON.stringify(manifest));
    assert.throws(()=>prepareAudio(tmp,bank),/ENOENT/);
    fs.writeFileSync(path.join(tmp,manifest.clips[manifest.demoText].file),'corrupt');
    assert.throws(()=>prepareAudio(tmp,bank),/Invalid listening clip/);
  }finally{fs.rmSync(tmp,{recursive:true,force:true});}
  const b=structuredClone(bank);b.questions.find(q=>q.type==='listening').audioText='A new unpublished script.';
  assert.throws(()=>prepareAudio(path.resolve(__dirname,'..'),b),/Missing listening clip/);
});
test('normal and slow playback keep pitch; restarting cancels the previous clip and stale events',()=>{
  const h=harness();h.play();
  const a=h.media[0],oldEnd=a.onended;
  assert.equal(a.playbackRate,1);assert.equal(a.preservesPitch,true);assert.equal(h.spoken.length,0);
  h.play(manifest.demoText,true);
  assert.equal(a.paused,true);assert.equal(h.media[1].playbackRate,.82);
  const before=h.messages.length;oldEnd();assert.equal(h.messages.length,before);
  h.player.stop();assert.equal(h.media[1].paused,true);assert.equal(h.timers.size,0);
});
test('network failure uses a quality English voice and sentence pauses',()=>{
  const voices=[{lang:'zh-CN',name:'Chinese'},{lang:'en-GB',name:'Basic'},{lang:'en-GB',name:'Natural English'}];
  const h=harness({voices});h.play();h.media[0].onerror();
  assert.equal(h.spoken[0].voice,voices[2]);assert.equal(h.spoken[0].text,'Hello!');
  h.spoken[0].onend();assert.equal(h.spoken.length,1);
  h.tick(350);assert.equal(h.spoken[1].text,'Let us review English together.');
  const callback=h.spoken[1].onend;h.player.stop();callback();
  assert.equal(h.timers.size,0);
});
test('delayed voice discovery works; stop removes its listener without starting a stale reading',()=>{
  const h=harness({clip:false});h.play();
  assert.equal(h.spoken.length,0);
  h.voices.push({lang:'en-US',name:'Google US English'});
  h.listeners.get('voiceschanged')();
  assert.equal(h.spoken.length,1);
  const other=harness({clip:false});other.play();const late=other.listeners.get('voiceschanged');
  other.player.stop();other.voices.push({lang:'en-GB',name:'English'});late();
  assert.equal(other.spoken.length,0);assert.equal(other.listeners.size,0);
});
test('no English voice never silently reads English through a Chinese voice',()=>{
  const h=harness({clip:false,voices:[{lang:'zh-CN',name:'Default'}]});h.play();
  assert.equal(h.spoken.length,0);assert.match(h.messages.at(-1),/没有可用的英文声音/);
});
test('browser playback permission errors invite a tap instead of hiding the error',async()=>{
  const h=harness({reject:{name:'NotAllowedError'}});h.play();
  await new Promise(resolve=>setImmediate(resolve));
  assert.match(h.messages.at(-1),/再次点击/);assert.equal(h.spoken.length,0);assert.equal(h.timers.size,0);
});
