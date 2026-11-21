// Local-only browser integration fixture. Never copied to dist or production.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {handle,digest,questionIdentity} from '../learning-server.mjs';
import {accountSeeds,accountCode} from '../account-server.mjs';
import E from '../engine.js';
import R from '../rewards.js';
const root=path.resolve(import.meta.dirname,'..'),bank=JSON.parse(fs.readFileSync(path.join(root,'question-bank.json')));
const mf=new Miniflare(convertV4MiniflareOptions({name:'browser-accounts',modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['LEARNING_DB']}));
const db=await mf.getD1Database('LEARNING_DB'),secret='local-browser-fixture-only-'.repeat(3);
for(const file of ['0001_learning.sql','0002_accounts.sql'])for(const sql of fs.readFileSync(path.join(root,'migrations',file),'utf8').split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
await db.batch(await Promise.all(bank.questions.map(async q=>db.prepare('INSERT INTO questions VALUES(?,?,?,?)').bind(await digest(questionIdentity(q)),q.id,bank.revision,JSON.stringify(q)))));
const codes={};
for(const a of await accountSeeds(secret)){
  await db.prepare('INSERT INTO accounts(id,name,kind,code_hash) VALUES(?,?,?,?)').bind(a.id,a.name,a.kind,a.codeHash).run();
  codes[a.id]=await accountCode(secret,a.id);
}
const state=E.emptyState();E.syncBatches(bank,state);
for(let n=0;n<6;n++){
  const q=bank.questions[n];
  state.session={rewardId:'legacy-'+n,items:[q.id],index:0,results:[],day:E.day()};
  state.session.results.push(E.grade(bank,state,q.id,q.answer,false));
  state.session.index=1;R.settle(state);
}
R.open(state,'legacy-cat',()=>0);state.session=null;
const seed={bank,state,baseline:JSON.stringify(bank)};
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.webp':'image/webp','.mp3':'audio/mpeg'};
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'https://ella-english-review.pages.dev');
    if(url.pathname==='/__test__/bootstrap'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({seed,codes}));return;}
    if(url.pathname.startsWith('/api/')){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=Buffer.concat(chunks);
      const response=await handle(new Request(url,{method:req.method,headers:req.headers,...(body.length?{body}: {})}),{LEARNING_DB:db,LEARNING_ADMIN_TOKEN:secret});
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
    }
    const target=path.resolve(root,'dist','.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    if(!target.startsWith(path.join(root,'dist')+path.sep)){res.writeHead(403).end();return;}
    res.setHeader('Content-Type',types[path.extname(target)]||'application/octet-stream');
    res.end(fs.readFileSync(target));
  }catch(error){res.writeHead(500).end(error.message);}
});
server.listen(4187,'127.0.0.1',()=>console.log('Browser fixture ready on 4187'));
process.on('SIGTERM',async()=>{server.close();await mf.dispose();process.exit(0);});
