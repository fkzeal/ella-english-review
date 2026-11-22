import fs from 'node:fs';
import {recoverCredentials} from './cloud-credentials.mjs';
import {readReportDerivatives} from './report-derivatives.mjs';
recoverCredentials();
const input=JSON.parse(fs.readFileSync(process.argv[2]));
if(input.privateVerification?.verified!==true)throw new Error('Private verification required');
console.log(JSON.stringify(await readReportDerivatives(input.runId)));
