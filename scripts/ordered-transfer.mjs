// Keep transfer concurrency bounded and reconstruct chunks in manifest order.
export async function orderedTransfer(items,operation,limit=4){
  const output=new Array(items.length);
  let cursor=0,failed;
  async function worker(){
    while(cursor<items.length&&!failed){
      const index=cursor++;
      try{output[index]=await operation(items[index],index);}
      catch(error){failed=error;}
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  if(failed)throw failed;
  return output;
}
