/* Pre-recorded synthetic speech first; device voices are a labelled fallback. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ReviewAudio=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const DEMO_TEXT='Hello! Let us review English together. I always go swimming on Tuesdays.';
  function validateManifest(manifest,bank){
    const texts=new Set([DEMO_TEXT,...bank.questions.filter(q=>q.active!==false&&q.type==='listening').map(q=>q.audioText)]);
    for(const text of texts){
      const clip=manifest?.clips?.[text];
      if(!clip||typeof clip.file!=='string'||(!/^audio\/[a-f0-9]{24}\.mp3$/.test(clip.file)&&!/^data:audio\/mpeg;base64,[A-Za-z0-9+/]+=*$/.test(clip.file))||!/^[a-f0-9]{64}$/.test(clip.sha256))
        throw new Error('听力音频尚未同步，请稍后重试题库更新。');
    }
    return manifest;
  }
  function chooseVoice(voices){
    return voices.filter(v=>/^en(?:-|_)/i.test(v.lang)).map((voice,index)=>{
      const name=voice.name||'';
      const quality=/natural|neural|premium|enhanced/i.test(name)?100:/Google|Samantha|Daniel|Serena|Sonia|Emma/i.test(name)?50:0;
      return {voice,index,score:quality+(/^en[-_]GB$/i.test(voice.lang)?20:0)};
    }).sort((a,b)=>b.score-a.score||a.index-b.index)[0]?.voice;
  }
  function create(env,manifest){
    let ticket=0,audio=null,timer=null,pauseTimer=null,voiceCleanup=null,utterance=null;
    const later=env.setTimeout.bind(env),clear=env.clearTimeout.bind(env);
    function stop(){
      ticket++;clear(timer);clear(pauseTimer);
      if(voiceCleanup){voiceCleanup();voiceCleanup=null;}
      if(audio){
        audio.onended=audio.onerror=audio.onplaying=null;
        audio.pause();audio.removeAttribute('src');audio.load();audio=null;
      }
      if(env.speechSynthesis)env.speechSynthesis.cancel();
      utterance=null;
    }
    function play(text,{slow=false,tell=()=>{}}={}){
      stop();
      const current=ticket,valid=()=>ticket===current;
      const report=message=>{if(valid())tell(message);};
      function deviceSpeech(){
        if(!valid())return;
        const synth=env.speechSynthesis;
        if(!synth||!env.SpeechSynthesisUtterance){
          report('声音暂时无法播放，请重试，或请家长照读读题稿。');return;
        }
        function start(){
          if(!valid())return;
          const voice=chooseVoice(synth.getVoices());
          if(!voice){report('设备没有可用的英文声音，请重试音频或使用家长读题稿。');return;}
          const sentences=text.match(/[^.!?]+[.!?]*\s*/g)||[text];
          let index=0;
          function next(){
            if(!valid())return;
            if(index===sentences.length){clear(timer);report('播放结束，可以再听一次。');return;}
            const u=utterance=new env.SpeechSynthesisUtterance(sentences[index++].trim());
            u.voice=voice;u.lang=voice.lang;u.pitch=1;u.rate=slow?.72:.9;
            u.onstart=()=>report('正在使用设备备用声音…');
            u.onend=()=>{if(valid())pauseTimer=later(next,slow?500:350);};
            u.onerror=()=>{if(valid()){clear(timer);report('备用声音未能播放，请重试或使用家长读题稿。');}};
            synth.speak(u);
          }
          timer=later(()=>{if(valid()){stop();tell('朗读超时，请重试或使用家长读题稿。');}},90000);
          next();
        }
        if(synth.getVoices().length){start();return;}
        // Mobile browsers often populate the voice list after the first request.
        let done=false;
        const ready=()=>{if(done)return;done=true;clear(pauseTimer);if(voiceCleanup)voiceCleanup();voiceCleanup=null;start();};
        if(synth.addEventListener){
          synth.addEventListener('voiceschanged',ready);
          voiceCleanup=()=>synth.removeEventListener('voiceschanged',ready);
        }
        pauseTimer=later(ready,1200);
        report('正在准备英文声音…');
      }
      const clip=manifest.clips?.[text];
      if(!clip||!env.Audio){deviceSpeech();return;}
      if(!/^audio\/[a-f0-9]{24}\.mp3$/.test(clip.file)&&!/^data:audio\/mpeg;base64,/.test(clip.file)){
        report('音频地址无效，请重新加载页面。');return;
      }
      let fellBack=false;
      const fallback=()=>{
        if(!valid()||fellBack)return;
        fellBack=true;clear(timer);
        if(audio){audio.onended=audio.onerror=audio.onplaying=null;audio.pause();audio.removeAttribute('src');audio.load();audio=null;}
        deviceSpeech();
      };
      try{
        audio=new env.Audio(clip.file);audio.preload='auto';
        audio.playbackRate=slow?.82:1;
        audio.preservesPitch=true;audio.webkitPreservesPitch=true;
        audio.onplaying=()=>{if(valid()){clear(timer);report(slow?'正在慢速播放…':'正在播放听力…');timer=later(fallback,90000);}};
        audio.onended=()=>{if(valid()){clear(timer);report('播放结束，可以再听一次。');}};
        audio.onerror=fallback;
        report('正在准备听力…');
        timer=later(fallback,12000);
        const promise=audio.play();
        if(promise?.catch)promise.catch(error=>{
          if(!valid()||fellBack)return;
          if(error?.name==='NotAllowedError'){
            clear(timer);report('请再次点击播放，允许浏览器播放声音。');
          }else fallback();
        });
      }catch{fallback();}
    }
    function updateManifest(next){stop();manifest=next;}
    return {play,stop,updateManifest};
  }
  return {create,chooseVoice,validateManifest,DEMO_TEXT};
});
