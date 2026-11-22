const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../answer-sounds');
function harness({missing=false,delayed=false}={}){
  const sources=[],requests=[];
  let resolve;
  const gate=delayed?new Promise(r=>resolve=r):Promise.resolve();
  const env={
    fetch:async file=>{requests.push(file);await gate;return {ok:!missing,arrayBuffer:async()=>file};},
    AudioContext:class{
      constructor(){this.state='suspended';this.destination={};}
      resume(){this.state='running';return Promise.resolve();}
      decodeAudioData(bytes){return Promise.resolve({file:bytes});}
      createBufferSource(){
        const source={connect(){},disconnect(){},start(){this.started=true;},stop(){this.stopped=true;}};
        sources.push(source);return source;
      }
    }
  };
  return {player:create(env),sources,requests,resolve:()=>resolve?.()};
}
test('effects are unlocked by a gesture and play the supplied correct or incorrect clip once',async()=>{
  const {player,sources}=harness();
  await player.play(true);assert.equal(sources.length,0);
  player.prime();await player.play(true);
  assert.equal(sources.length,1);assert.equal(sources[0].buffer.file,'audio/effects/correct.wav');
  await player.play(false);
  assert(sources[0].stopped);assert.equal(sources[1].buffer.file,'audio/effects/incorrect.wav');
});
test('leaving a question cancels a sound that is still loading',async()=>{
  const {player,sources,resolve}=harness({delayed:true});
  player.prime();const pending=player.play(true);player.stop();resolve();await pending;
  assert.equal(sources.length,0);
});
test('missing clips and unsupported audio do not reject or block feedback',async()=>{
  const {player,sources}=harness({missing:true});
  player.prime();await player.play(true);assert.equal(sources.length,0);
  const unavailable=create({});unavailable.prime();await unavailable.play(false);
});
