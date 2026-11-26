import {auth} from './firebase';

export type ProductionDirectoryScope='social'|'admin';
// The professional client stays on its local-only pilot until the write
// boundary for invitations is ready. A browser flag is not authorization.
export function privateDirectoryProductionEnabled(scope:ProductionDirectoryScope):boolean{
 const enabled=scope==='social'
  ?import.meta.env?.VITE_KYRUB_PRIVATE_DIRECTORY_SOCIAL_ENABLED==='true'
  :import.meta.env?.VITE_KYRUB_PRIVATE_DIRECTORY_ADMIN_ENABLED==='true';
 return enabled&&import.meta.env?.PROD===true&&
  typeof window!=='undefined'&&window.location.protocol==='https:'&&
  ['www.kyrub.com','kyrub.com','admin.kyrub.com'].includes(window.location.hostname)&&
  auth.app.options.projectId==='kyrub-b8d0e';
}
export function privateDirectoryRequest(scope:ProductionDirectoryScope,operation:string,input:unknown,localUrl:string){
 if(privateDirectoryProductionEnabled(scope)){
  return {url:'/api/health?transport=private-identity-directory',body:JSON.stringify({scope,operation,input})};
 }
 return {url:localUrl,body:JSON.stringify(input)};
}
