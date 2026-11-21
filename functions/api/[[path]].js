import {handle} from '../../learning-server.mjs';
export function onRequest({request,env}){return handle(request,env);}
