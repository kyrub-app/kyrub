import type {AuthenticationResponseJSON,PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import type {CidOwnerCentralSession} from '../components/KyrubCidOwnerCentralHomologation';
import type {CidRecipientConsentEntry} from '../components/KyrubCidSosRecipientConsent';
import type {CidEditorView,CidEditorDraft,CidEditorChannel} from '../../shared/cidSosConfigEditor';
const origin='https://kyrub-cid-emulator.vercel.app';
type Credential={id:string;secret:string};
type Ceremony={challengeId:string;options:PublicKeyCredentialRequestOptionsJSON};
const deny=():never=>{throw Error('CID_CENTRAL_HTTP_DENIED');};
const opaque=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
function valid(c:Credential){if(!c||!opaque(c.id)||!opaque(c.secret))return deny();return {id:c.id,secret:c.secret};}
// Deliberately not mounted in a public route. Browser keeps only the consent
// and withdrawal handles in memory; the central session is a scoped HttpOnly cookie.
export function createCidOwnerCentralHomologationHttpClient(tagId:string){
 if(window.location.origin!==origin||!/^[a-f0-9]{32}$/.test(tagId))return deny();
 async function post<T>(scope:'central'|'consent',action:string,value:unknown):Promise<T>{
  if(window.location.origin!==origin)return deny();
  const response=await fetch('/cid-homologation/api/'+tagId+'/'+scope+'/'+action,{
   method:'POST',mode:'same-origin',credentials:scope==='central'?'same-origin':'omit',cache:'no-store',redirect:'error',
   headers:{'Content-Type':'application/json','X-Cid-Homologation':'1'},body:JSON.stringify(value)
  });
  if(!response.ok)return deny();return await response.json() as T;
 }
 async function open(authenticate:(options:PublicKeyCredentialRequestOptionsJSON)=>Promise<AuthenticationResponseJSON>):Promise<CidOwnerCentralSession>{
  const ceremony=await post<Ceremony>('central','begin',{}),response=await authenticate(ceremony.options);
  const accepted=await post<{accepted:boolean}>('central','finish',{challengeId:ceremony.challengeId,response});
  if(accepted.accepted!==true)return deny();
  return {read:async()=>{const result=await post<Awaited<ReturnType<CidOwnerCentralSession['read']>>>('central','read',{});if(result.tagId!==tagId)return deny();return result;},
   revoke:async()=>{await post('central','revoke',{});},
   editor:{read:()=>post<CidEditorView>('central','editor',{}),
    save:async(draft:CidEditorDraft)=>{const change=await post<Ceremony>('central','config-begin',{draft});const signature=await authenticate(change.options);await post('central','config-finish',{challengeId:change.challengeId,response:signature});},
    requestConsent:async(participantId:string,channel:CidEditorChannel)=>{const result=await post<{prepared:boolean}>('central','consent-request',{participantId,channel});if(result.prepared!==true)return deny();}
   }};
 }
 function recipient(invitation:Credential):CidRecipientConsentEntry{
  const bound=valid(invitation);
  return {mode:'confirm',confirm:()=>post('consent','confirm',{invitation:bound,consent:true}),revoke:handle=>post('consent','revoke',{revocation:valid(handle)})};
 }
 function withdrawal(handle:Credential):CidRecipientConsentEntry{
  const bound=valid(handle);return {mode:'revoke',revoke:()=>post('consent','revoke',{revocation:bound})};
 }
 return {open,recipient,withdrawal};
}
