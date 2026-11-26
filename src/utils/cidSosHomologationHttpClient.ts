import type {AuthenticationResponseJSON,PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import type {CidSosResolution} from '../../shared/cidSosResolution';
import type {CidSosRequest,CidSosSharedLocation} from '../../shared/cidSosRequest';
import type {CidChatView} from '../components/KyrubCidOccurrenceChat';
import type {HomologationEntry,HomologationChatSession} from '../components/KyrubCidSosHomologation';

// Not imported by public routes. All calls are same-origin and the session cookie
// stays HttpOnly. No localStorage, query credentials, or cross-origin fallback.
const origin='https://kyrub-cid-emulator.vercel.app';
const tagPattern=/^[a-f0-9]{32}$/,occurrencePattern=/^[A-Za-z0-9_-]{22,80}$/;
type Invitation={id:string;secret:string};
const deny=():never=>{throw Error('CID_HTTP_DENIED');};
function seed(){
 const bytes=crypto.getRandomValues(new Uint8Array(32));
 return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function createCidSosHomologationHttpClient(tagId:string){
 if(window.location.origin!==origin||!tagPattern.test(tagId))return deny();
 async function post<T>(id:string,action:string,value:unknown):Promise<T>{
  if(!occurrencePattern.test(id)||window.location.origin!==origin)return deny();
  const response=await fetch('/cid-homologation/api/'+tagId+'/'+id+'/'+action,{
   method:'POST',mode:'same-origin',credentials:'same-origin',redirect:'error',cache:'no-store',
   headers:{'Content-Type':'application/json','X-Cid-Homologation':'1'},body:JSON.stringify(value)
  });
  if(!response.ok)return deny();
  return await response.json() as T;
 }
 function session(id:string,role:HomologationEntry['role']):HomologationChatSession{
  return {read:async()=>{const v=await post<CidChatView>(id,'read',{});if(v.id!==id||v.role!==role)return deny();return v;},
   send:async input=>{await post(id,'send',input);},
   revoke:async()=>{await post(id,'revoke',{});},
   ...(role==='owner'?{exportOccurrence:async(format:'text'|'structured')=>{
    const result=await post<{reportId:string;format:string;content:string;simulated:true}>(id,'export',{format});
    if(result.simulated!==true||result.format!==format||typeof result.content!=='string'||!/^[a-f0-9-]{36}$/.test(result.reportId))return deny();
    const blob=new Blob([result.content],{type:format==='text'?'text/plain;charset=utf-8':'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='kyrub-cid-homologacao-'+result.reportId+(format==='text'?'.txt':'.json');
    document.body.append(link);try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
   },preserveEvidence:async(reason:string)=>post<{id:string;status:'pending-review'}>(id,'preserve',{reason}),resolve:async(resolution:CidSosResolution)=>{await post(id,'close',{resolution});}}:{})};
 }
 function emitter(smsAvailable:boolean,requestLocation?:()=>Promise<Omit<CidSosSharedLocation,'consent'>>):HomologationEntry{
  let previous:{id:string;seed:string}|undefined;
  return {role:'emitter',smsAvailable,requestLocation,submit:async(request:CidSosRequest)=>{
   if(previous?.id!==request.id)previous={id:request.id,seed:seed()};
   await post(request.id,'emit',{request,seed:previous.seed});
   return session(request.id,'emitter');
  }};
 }
 function owner(id:string,authenticate:(options:PublicKeyCredentialRequestOptionsJSON)=>Promise<AuthenticationResponseJSON>):HomologationEntry{
  return {role:'owner',open:async()=>{
   const ceremony=await post<{challengeId:string;options:PublicKeyCredentialRequestOptionsJSON}>(id,'owner-begin',{});
   const response=await authenticate(ceremony.options);
   await post(id,'owner-finish',{challengeId:ceremony.challengeId,response});
   return session(id,'owner');
  }};
 }
 function contact(id:string,invitation:Invitation):HomologationEntry{
  let challengeId:string|undefined;
  return {role:'contact',requestConfirmation:async()=>{
   challengeId=undefined;
   const result=await post<{challengeId:string}>(id,'contact-request',{invitation});challengeId=result.challengeId;
  },confirm:async confirmation=>{
   if(!challengeId)return deny();
   await post(id,'contact-confirm',{invitation,challengeId,confirmation});
   challengeId=undefined;return session(id,'contact');
  }};
 }
 return {emitter,owner,contact};
}
