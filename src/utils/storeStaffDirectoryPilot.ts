import type {User} from 'firebase/auth';
import {auth} from './firebase';
import type {KyrubDirectoryUser} from './storeDirectory';
import type {StoreRole} from './storeSecurity';

export function staffDirectoryPilotEnabled(){
 return import.meta.env?.DEV===true&&import.meta.env?.VITE_KYRUB_STAFF_DIRECTORY_PILOT==='true'&&
 typeof window!=='undefined'&&window.location.hostname==='127.0.0.1'&&window.location.protocol==='http:'&&
 auth.app.options.projectId==='demo-kyrub-welcome';
}
async function request(user:User,operation:'search'|'invite',body:Record<string,string>){
 if(!staffDirectoryPilotEnabled()||auth.currentUser!==user)throw Error('Consulta de homologação indisponível.');
 const token=await user.getIdToken();
 if(auth.currentUser!==user)throw Error('Sessão alterada.');
 const response=await fetch('/api/staff-directory-pilot/'+operation,{
  method:'POST',cache:'no-store',credentials:'omit',redirect:'error',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)
 });
 if(auth.currentUser!==user)throw Error('Sessão alterada.');
 if(!response.ok)throw Error(response.status===429?'Limite de consultas atingido. Tente novamente em instantes.':response.status===409?'Convite já existente.':'Não foi possível concluir a operação.');
 const payload=await response.json();
 if(auth.currentUser!==user)throw Error('Sessão alterada.');
 return payload;
}
export async function searchStaffDirectoryPilot(user:User,storeId:string,term:string,role:StoreRole):Promise<KyrubDirectoryUser[]>{
 const payload=await request(user,'search',{storeId,term,role});
 if(!Array.isArray(payload?.entries)||payload.entries.length>10)throw Error('Resposta inválida.');
 return payload.entries.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object')throw Error('Resposta inválida.');
  const data=entry as Record<string,unknown>;
  if(typeof data.uid!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(data.uid)||typeof data.name!=='string'||typeof data.photoUrl!=='string')
   throw Error('Resposta inválida.');
  return {uid:data.uid,name:data.name,photoUrl:data.photoUrl,email:''};
 });
}
export async function inviteStaffDirectoryPilot(user:User,storeId:string,term:string,role:StoreRole,targetUid:string){
 const payload=await request(user,'invite',{storeId,term,role,targetUid});
 if(payload?.status!=='invited'||payload.userId!==targetUid)throw Error('Convite não confirmado.');
}
