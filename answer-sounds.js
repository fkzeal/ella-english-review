/* Answer effects supplied by the user; independent of English listening audio. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.AnswerSounds=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const FILES={correct:'audio/effects/correct.wav',incorrect:'audio/effects/incorrect.wav'};
  function create(env){
    let context=null,source=null,ticket=0;
    const buffers=new Map();
    // Start downloading before the answer so decoding never blocks saving.
    const downloads=new Map(Object.entries(FILES).map(([name,file])=>[name,
      env.fetch?env.fetch(file).then(response=>response.ok?response.arrayBuffer():null).catch(()=>null):Promise.resolve(null)]));
    function prime(){
      const Context=env.AudioContext||env.webkitAudioContext;
      if(!Context)return;
      try{
        context ||= new Context();
        // Called synchronously from the click, before locks/network/storage awaits.
        // A running context can play the result after the answer is committed on iOS.
        if(context.state!=='running')context.resume().catch(()=>{});
        for(const [name,download] of downloads)if(!buffers.has(name)){
          buffers.set(name,download.then(bytes=>bytes?context.decodeAudioData(bytes):null).catch(()=>null));
        }
      }catch{}
    }
    function stop(){
      ticket++;
      if(source){source.onended=null;try{source.stop();}catch{}source.disconnect();source=null;}
    }
    async function play(correct){
      stop();
      const current=ticket,started=Date.now();
      try{
        const buffer=await buffers.get(correct?'correct':'incorrect');
        if(!buffer||current!==ticket||context?.state!=='running'||Date.now()-started>1000)return;
        const next=context.createBufferSource();next.buffer=buffer;next.connect(context.destination);
        next.onended=()=>{next.disconnect();if(source===next)source=null;};
        source=next;next.start();
      }catch{}
    }
    return {prime,play,stop};
  }
  return {create,FILES};
});
