import {auth} from './firebase';
import {publishSocialPrivacyInvalidation} from './socialPrivacyInvalidation';
import {verifySocialPilotStorage} from './socialPilotStorageGuard';
type PilotAction='status'|'setup'|'unlock'|'lock'|'session-check'|'directory'|'reserved-directory'|'suggestions'|'connection'|'favorite'|'tribe-create'|'tribe-member'|'tribe-delete'|'membership'|'recover'|'ordinary-forward'|'ordinary-chat-read'|'ordinary-chat-send'|'ordinary-chat-clear'|'chat-read'|'chat-send'|'chat-clear'|'notifications'|'notification-read';
export type ReservedTribeUnlock={ok:false}|{ok:true;token:string;expiresAt:number};
/** Homologation-only client, not mounted by any production component.
 * Never persist a code or capability. Reject a changed auth session after
 * every await; callers must also clear the session on unmount/visibility.
 */
export function reservedTribePilotClientEnabled(){
 return import.meta.env?.DEV===true&&import.meta.env?.VITE_KYRUB_FIREBASE_EMULATOR_E2E==='true'&&
    import.meta.env?.VITE_KYRUB_SOCIAL_MEMORY_CACHE_E2E==='true'&&typeof window!=='undefined'&&
    ['localhost','127.0.0.1'].includes(window.location.hostname)&&auth.app.options.projectId==='kyrub-security-test';
}
export async function requestReservedTribePilot<T>(action:PilotAction,fields:Record<string,unknown>={},signal?:AbortSignal):Promise<T>{
 if(!reservedTribePilotClientEnabled())throw Error('TRIBE_UNAVAILABLE');
 const user=auth.currentUser;
 if(!user)throw Error('AUTH_REQUIRED');
 // Lock is a revocation-only operation; never obstruct it with a storage gate.
 if(action!=='lock')await verifySocialPilotStorage();
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 const idToken=await user.getIdToken(action==='recover');
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 const response=await fetch('/api/social/reserved-tribe',{
  method:'POST',cache:'no-store',credentials:'same-origin',redirect:'error',signal,
  headers:{'content-type':'application/json','authorization':'Bearer '+idToken},
  body:JSON.stringify({...fields,action}),
 });
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 if(!response.ok){
  if(action==='ordinary-forward'&&response.status===409){const failure=await response.json().catch(()=>null);if(failure?.error==='TRIBE_FORWARD_DUPLICATE')throw Error('TRIBE_FORWARD_DUPLICATE');}
  throw Error('TRIBE_UNAVAILABLE');
 }
 const result=await response.json() as T;
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 if(action!=='lock'){
  try{await verifySocialPilotStorage();}catch(error){
   // If an unlock succeeded just as the origin became unsafe, revoke that
   // capability without returning it to the UI. Server expiry is fallback.
   if(action==='unlock'&&(result as {ok?:boolean})?.ok===true&&auth.currentUser===user){
    const token=(result as {token?:string}).token;
    if(typeof token==='string')void requestReservedTribePilot('lock',{session:token}).catch(()=>{});
   }
   throw error;
  }
 }
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 if(action==='connection'||action==='favorite'||action==='tribe-create'||action==='tribe-member'||action==='tribe-delete'||action==='membership'||action==='recover'||(action==='unlock'&&(result as {ok?:boolean})?.ok===true))publishSocialPrivacyInvalidation();
 return result;
}
