import type {PrivacyRightsAdapter,PrivacyRequestReceipt,PrivacyRequestDraft} from '../../shared/privacyRights';
import type {PrivacyTrackingAdapter} from '../components/KyrubPrivacyTrackingPilot';
import type {PrivacyAdminAdapter} from '../../shared/privacyAdminWorkspace';
import type {OptionalConsentAdapter} from '../../shared/privacyOptionalConsent';
import type {AuthenticationResponseJSON,PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
const origin='https://127.0.0.1:8449',cidOrigin='https://kyrub-privacy-emulator.vercel.app';
const allowed=()=>window.location.origin===origin||window.location.origin===cidOrigin;
const deny=():never=>{throw Error('PRIVACY_HTTP_DENIED');};
type Credential={id:string;secret:string};
type TokenSource=()=>Promise<string>;
const opaque=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const random=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
// Explicit local harness only. No production Auth, storage, cookies or fallback.
export function createPrivacyHomologationHttpClient(){
 if(!allowed())return deny();
 async function post<T>(action:string,value:unknown,getToken?:TokenSource):Promise<T>{
  if(!allowed())return deny();
  const headers:Record<string,string>={'Content-Type':'application/json','X-Privacy-Homologation':'1'};
  if(getToken){const token=await getToken();if(typeof token!=='string'||!token||token.length>8192||/\s/.test(token))return deny();headers.Authorization='Bearer '+token;}
  const res=await fetch('/privacy-homologation/api/'+action,{method:'POST',mode:'same-origin',credentials:'omit',cache:'no-store',redirect:'error',headers,body:JSON.stringify(value)});
  if(!res.ok)return deny();return await res.json() as T;
 }
 function intake(credential:Credential):PrivacyRightsAdapter{
  if(!credential||!opaque(credential.id)||!opaque(credential.secret))return deny();
  const bound={id:credential.id,secret:credential.secret};
  let pending:{fingerprint:string;requestId:string}|null=null;
  return {submit:async(draft:PrivacyRequestDraft)=>{
   const fingerprint=JSON.stringify(draft);
   if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,requestId:random()};
   const receipt=await post<PrivacyRequestReceipt>('submit',{credential:bound,requestId:pending.requestId,draft});
   if(receipt.simulated!==true||receipt.status!=='received')return deny();
   return receipt;
  }};
 }
 function tracking(getToken?:TokenSource,authenticate?:(options:PublicKeyCredentialRequestOptionsJSON)=>Promise<AuthenticationResponseJSON>):PrivacyTrackingAdapter{
  return {track:(protocol,code)=>post('track',{protocol,code}),revoke:(protocol,code)=>post('revoke',{protocol,code}),...(getToken?{confirmAccount:(protocol:string,code:string)=>post<Awaited<ReturnType<NonNullable<PrivacyTrackingAdapter['confirmAccount']>>>>('confirm-account',{protocol,code},getToken)}:{}),...(authenticate&&window.location.origin===cidOrigin?{confirmCid:async(protocol:string,code:string)=>{const c=await post<{challengeId:string;options:PublicKeyCredentialRequestOptionsJSON}>('cid-begin',{protocol,code});if(!opaque(c.challengeId))return deny();const response=await authenticate(c.options);return post<Awaited<ReturnType<NonNullable<PrivacyTrackingAdapter['confirmCid']>>>>('cid-finish',{protocol,code,challengeId:c.challengeId,response});}}:{})};
 }
 function admin(getToken:TokenSource):PrivacyAdminAdapter{
  return {list:()=>post('admin-list',{},getToken),triage:input=>post('admin-triage',input,getToken),assess:input=>post('admin-assess',input,getToken),prepareResponse:input=>post('admin-prepare',input,getToken),reviewResponse:input=>post('admin-review',input,getToken)};
 }
 function consents(getToken:TokenSource):OptionalConsentAdapter{
  return {list:()=>post('consents-list',{},getToken),change:choice=>post('consents-change',choice,getToken)};
 }
 return {intake,tracking,admin,consents};
}
