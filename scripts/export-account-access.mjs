// Only ciphertext leaves this process. Never export the administration secret.
import fs from 'node:fs';
import {createPublicKey, publicEncrypt, randomBytes, createCipheriv} from 'node:crypto';
const key=createPublicKey({key:Buffer.from(process.env.RECIPIENT_PUBLIC_KEY||'','base64'),format:'der',type:'spki'});
if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072)throw new Error('RSA public key must be at least 3072 bits');
const token=process.env.LEARNING_ADMIN_TOKEN;
if(!token)throw new Error('Missing administration credential');
const base='https://ella-english-review.pages.dev';
async function query(route,body){
  const r=await fetch(base+'/api/admin/'+route,{method:body?'POST':'GET',headers:{
    Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json',Origin:base}:{})
  },...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw new Error('Account verification failed: HTTP '+r.status);
  return r.json();
}
const {accounts}=await query('accounts');
const expected=['ella','dad','mom','test-1','test-2','test-3'];
if(!expected.every(id=>accounts.some(a=>a.id===id)))throw new Error('Required accounts not initialized');
const exported=[];
for(const id of expected){
  const {code}=await query('account-code',{accountId:id});
  if(!/^[a-f0-9]{24}$/.test(code))throw new Error('Invalid account code response');
  exported.push({id,name:accounts.find(a=>a.id===id).name,code});
}
const secret=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);
const ciphertext=Buffer.concat([cipher.update(JSON.stringify({site:base,accounts:exported})),cipher.final()]);
fs.writeFileSync('account-access.encrypted.json',JSON.stringify({
  algorithm:'RSA-OAEP-SHA256+AES-256-GCM',
  key:publicEncrypt({key,oaepHash:'sha256'},secret).toString('base64'),
  iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')
}),{mode:0o600});
console.log('Verified six initialized accounts; encrypted access artifact ready.');
