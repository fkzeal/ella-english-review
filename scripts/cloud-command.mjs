import {spawnSync} from 'node:child_process';
import {recoverCredentials} from './cloud-credentials.mjs';
recoverCredentials();
process.env.GH_DEBUG='';
const [command,...args]=process.argv.slice(2);
if(!['gh','git'].includes(command))throw new Error('Expected gh or git');
// Git authentication uses gh with recovered process environment, never a token URL.
const options=command==='git'?['-c','credential.helper=!gh auth git-credential',...args]:args;
const result=spawnSync(command,options,{env:process.env,stdio:'inherit',timeout:180000});
process.exitCode=result.status??1;
