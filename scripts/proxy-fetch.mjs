// Resolve from this checkout; no inherited /workspace path is required.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {EnvHttpProxyAgent,setGlobalDispatcher}=require('undici');
if(['HTTPS_PROXY','HTTP_PROXY','https_proxy','http_proxy'].some(k=>process.env[k])){
  setGlobalDispatcher(new EnvHttpProxyAgent());
}
