import type {User} from 'firebase/auth';
import {auth} from './firebase';
import {privateDirectoryProductionEnabled,privateDirectoryRequest} from './privateDirectoryClientTransport';
import type {AdminDirectoryUserRecord} from './adminDirectory';

export function adminDirectoryPilotEnabled(){
 return privateDirectoryProductionEnabled('admin')||(import.meta.env?.DEV===true&&import.meta.env?.VITE_KYRUB_ADMIN_DIRECTORY_PILOT==='true'&&
 typeof window!=='undefined'&&window.location.hostname==='127.0.0.1'&&window.location.protocol==='http:'&&
 auth.app.options.projectId==='demo-kyrub-welcome');
}
export async function lookupAdminDirectoryPilot(user:User,term:string):Promise<AdminDirectoryUserRecord|null>{
 if(!adminDirectoryPilotEnabled()||auth.currentUser!==user)throw Error('Consulta administrativa indisponível.');
 const token=await user.getIdToken();
 if(auth.currentUser!==user)throw Error('Sessão alterada.');
 const request=privateDirectoryRequest('admin','identity',{term},'/api/admin-directory-pilot/identity');
 const response=await fetch(request.url,{
  method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:request.body
 });
 if(!response.ok||auth.currentUser!==user)throw Error('Consulta administrativa indisponível ou não autorizada.');
 const payload=await response.json();
 if(auth.currentUser!==user)throw Error('Sessão alterada.');
 if(payload?.user===null)return null;
 const data=payload?.user;
 if(!data||typeof data.uid!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(data.uid)||
  typeof data.name!=='string'||typeof data.email!=='string'||typeof data.photoUrl!=='string'||
  typeof data.isProfileVisible!=='boolean'||typeof data.createdAt!=='string'||typeof data.updatedAt!=='string')
  throw Error('Resposta administrativa inválida.');
 return {uid:data.uid,name:data.name,email:data.email,photoUrl:data.photoUrl,isProfileVisible:data.isProfileVisible,
  createdAt:data.createdAt,updatedAt:data.updatedAt};
}


export async function countAdminDirectoryUsersPilot(user:User):Promise<number>{
 if(!adminDirectoryPilotEnabled()||auth.currentUser!==user)throw Error('Consulta administrativa indisponível.');
 const token=await user.getIdToken();
 if(auth.currentUser!==user)throw Error('Sessão alterada.');
 const request=privateDirectoryRequest('admin','count',{},'/api/admin-directory-pilot/count');
 const response=await fetch(request.url,{
  method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:request.body
 });
 if(!response.ok||auth.currentUser!==user)throw Error('Consulta administrativa indisponível ou não autorizada.');
 const payload=await response.json();
 if(auth.currentUser!==user||!Number.isSafeInteger(payload?.count)||payload.count<0)throw Error('Resposta administrativa inválida.');
 return payload.count;
}
