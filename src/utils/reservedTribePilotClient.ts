import {auth} from './firebase';
type PilotAction='status'|'setup'|'unlock'|'lock'|'directory'|'reserved-directory'|'suggestions'|'connection'|'favorite'|'membership'|'recover'|'chat-read'|'chat-send'|'chat-clear'|'notifications'|'notification-read';
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
 const idToken=await user.getIdToken(action==='recover');
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 const response=await fetch('/api/social/reserved-tribe',{
  method:'POST',cache:'no-store',credentials:'same-origin',redirect:'error',signal,
  headers:{'content-type':'application/json','authorization':'Bearer '+idToken},
  body:JSON.stringify({...fields,action}),
 });
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 if(!response.ok)throw Error('TRIBE_UNAVAILABLE');
 const result=await response.json() as T;
 if(auth.currentUser!==user||signal?.aborted)throw Error('TRIBE_ACCESS_DENIED');
 return result;
}
