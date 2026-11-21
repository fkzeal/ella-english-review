// Workflow dispatch requires repository Actions write permission.
// Only the recipient holding the ephemeral private key can decrypt this artifact.
import fs from 'node:fs';
import {createPublicKey,publicEncrypt,randomBytes,createCipheriv} from 'node:crypto';
const key=createPublicKey({key:Buffer.from(process.env.RECIPIENT_PUBLIC_KEY||'','base64'),format:'der',type:'spki'});
if(key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength<3072)throw new Error('RSA 3072 required');
const token=process.env.LEARNING_ADMIN_TOKEN;
if(!token||token.length<40)throw new Error('Existing administration credential missing');
const secret=randomBytes(32),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',secret,iv);
const ciphertext=Buffer.concat([cipher.update(JSON.stringify({LEARNING_ADMIN_TOKEN:token})),cipher.final()]);
fs.writeFileSync('maintenance-access.encrypted.json',JSON.stringify({
  algorithm:'RSA-OAEP-SHA256+AES-256-GCM',
  key:publicEncrypt({key,oaepHash:'sha256'},secret).toString('base64'),
  iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')
}),{mode:0o600});
console.log('Encrypted maintenance access ready.');
