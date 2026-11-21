// A five-minute server lease is renewed during one bounded maintenance run.
import fs from 'node:fs';
import {api} from './cloud-state.mjs';
const file=process.argv[2],deadline=Date.now()+2*60*60*1000;
try{
  while(Date.now()<deadline&&!fs.existsSync(file+'.stop')){
    const {owner}=JSON.parse(fs.readFileSync(file));
    await api('lease',{owner});
    await new Promise(resolve=>setTimeout(resolve,30000));
  }
}catch{/* Fenced writers must stop; expiry frees the lease automatically. */}
