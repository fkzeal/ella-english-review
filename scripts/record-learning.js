// Run by the maintainer after dates and book contents are confirmed in conversation.
const fs=require('node:fs'),path=require('node:path');
const E=require('../engine');
const root=path.resolve(__dirname,'..');
const args=process.argv.slice(2),at=args.indexOf('--file');
if(at<0||!args[at+1]){
  console.error('Usage: npm run record -- --file /path/to/confirmed-learning-batches.json [--replace]');
  process.exit(1);
}
try{
  const bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json'),'utf8'));
  const input=JSON.parse(fs.readFileSync(path.resolve(args[at+1]),'utf8'));
  const batches=Array.isArray(input)?input:[input];
  const map=new Map((bank.batches||[]).map(b=>[b.id,b]));
  for(const batch of batches){
    if(map.has(batch.id)&&JSON.stringify(map.get(batch.id))!==JSON.stringify(batch)&&!args.includes('--replace'))throw new Error('该批次已有不同内容；确认修改学习日期后使用 --replace，复读请使用新编号。');
    map.set(batch.id,batch);
  }
  if(JSON.stringify(bank.batches||[])===JSON.stringify([...map.values()])){
    console.log('Learning batches unchanged; nothing to publish.');process.exit(0);
  }
  const updated={...bank,revision:(bank.revision||0)+1,updated:E.day(),batches:[...map.values()]};
  E.validateBank(updated);
  const target=path.join(root,'question-bank.json'),temp=target+'.tmp';
  fs.writeFileSync(temp,JSON.stringify(updated,null,2)+'\n');
  fs.renameSync(temp,target);
  console.log(`Recorded ${batches.length} confirmed learning batch(es). Run npm test and npm run build before publishing.`);
}catch(err){console.error(err.message);process.exit(1);}
