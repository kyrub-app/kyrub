import type {User} from 'firebase/auth';
import {auth} from './firebase';
import {privateDirectoryProductionEnabled,privateDirectoryRequest} from './privateDirectoryClientTransport';

const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(id);
export function socialDirectoryPilotEnabled(){
 return privateDirectoryProductionEnabled('social')||(import.meta.env?.DEV===true&&import.meta.env?.VITE_KYRUB_SOCIAL_DIRECTORY_PILOT==='true'&&
 typeof window!=='undefined'&&window.location.hostname==='127.0.0.1'&&window.location.protocol==='http:'&&
 auth.app.options.projectId==='demo-kyrub-welcome');
}
async function request(user:User,operation:'page'|'authors'|'collaborators',body:unknown,signal?:AbortSignal){
 if(!socialDirectoryPilotEnabled()||auth.currentUser!==user)throw Error('DIRECTORY_UNAVAILABLE');
 const token=await user.getIdToken();
 if(auth.currentUser!==user||signal?.aborted)throw Error('DIRECTORY_SESSION_CHANGED');
 const request=privateDirectoryRequest('social',operation,body,'/api/social-directory-pilot/'+operation);
 const response=await fetch(request.url,{
  method:'POST',cache:'no-store',credentials:'omit',redirect:'error',signal,
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:request.body
 });
 if(!response.ok||auth.currentUser!==user)throw Error('DIRECTORY_UNAVAILABLE');
 const payload=await response.json();
 if(auth.currentUser!==user||signal?.aborted)throw Error('DIRECTORY_SESSION_CHANGED');
 if(!Array.isArray(payload?.entries)||payload.entries.length>40)throw Error('DIRECTORY_RESPONSE_INVALID');
 return payload;
}
export async function readSocialDirectoryPilotPage(user:User,after?:string,signal?:AbortSignal){
 if(after!==undefined&&!validId(after))throw Error('DIRECTORY_INPUT_INVALID');
 const payload=await request(user,'page',after===undefined?{}:{after},signal);
 if(payload.nextCursor!==null&&(!validId(payload.nextCursor)||payload.nextCursor===after))throw Error('DIRECTORY_RESPONSE_INVALID');
 const entries=payload.entries.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object')throw Error('DIRECTORY_RESPONSE_INVALID');
  const data=entry as Record<string,unknown>;
  if(!validId(data.id)||typeof data.name!=='string'||typeof data.photoUrl!=='string'||data.isProfileVisible!==true)throw Error('DIRECTORY_RESPONSE_INVALID');
  return {id:data.id,name:data.name,photoUrl:data.photoUrl,isProfileVisible:true as const};
 });
 return {entries,nextCursor:payload.nextCursor as string|null};
}
export async function readAuthorIdentitiesPilot(user:User,ids:string[],signal?:AbortSignal){
 if(ids.length>40||ids.some(id=>!validId(id)))throw Error('DIRECTORY_INPUT_INVALID');
 const payload=await request(user,'authors',{authorIds:ids},signal);
 const requested=new Set(ids);
 return payload.entries.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object')throw Error('DIRECTORY_RESPONSE_INVALID');
  const data=entry as Record<string,unknown>;
  if(!validId(data.id)||!requested.has(data.id)||typeof data.name!=='string'||typeof data.avatar!=='string')throw Error('DIRECTORY_RESPONSE_INVALID');
  return {id:data.id,name:data.name,avatar:data.avatar};
 }) as {id:string;name:string;avatar:string}[];
}

export async function searchNoteCollaboratorsPilot(user:User,term:string,signal?:AbortSignal){
 const payload=await request(user,'collaborators',{term},signal);
 if(payload.entries.length>10)throw Error('DIRECTORY_RESPONSE_INVALID');
 return payload.entries.map((entry:unknown)=>{
  if(!entry||typeof entry!=='object')throw Error('DIRECTORY_RESPONSE_INVALID');
  const data=entry as Record<string,unknown>;
  if(!validId(data.id)||data.id===user.uid||typeof data.name!=='string'||typeof data.photoUrl!=='string'||data.isProfileVisible!==true)
   throw Error('DIRECTORY_RESPONSE_INVALID');
  return {id:data.id,name:data.name,avatar:data.photoUrl,role:'Kairubido',email:''};
 });
}
