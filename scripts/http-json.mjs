// All callers use reads or server-side idempotent operations.
export async function fetchJson(url,options={}){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
      const body=await response.json();
      if(response.status>=500&&attempt<2)continue;
      return {status:response.status,ok:response.ok,body};
    }catch(error){
      if(attempt===2)throw new Error('Network read failed after bounded retries');
    }
  }
}
