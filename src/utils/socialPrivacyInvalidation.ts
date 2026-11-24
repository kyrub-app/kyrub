// No identity, session, reason, count or contact information is shared.
// This signal is an invalidation hint, never evidence of authorization.
// No localStorage fallback: unsupported browsers recheck the server.
const EVENT='kyrub:social-privacy-invalidate';
const CHANNEL='kyrub-social-privacy-v1';
export function publishSocialPrivacyInvalidation(){
 if(typeof window==='undefined')return;
 window.dispatchEvent(new Event(EVENT));
 if(typeof BroadcastChannel!=='undefined'){
  try{const channel=new BroadcastChannel(CHANNEL);channel.postMessage('refresh');channel.close();}catch{/* Server polling remains the authority. */}
 }
}
export function subscribeSocialPrivacyInvalidation(onInvalidate:()=>void,includeLocal=true){
 if(typeof window==='undefined')return ()=>{};
 if(includeLocal)window.addEventListener(EVENT,onInvalidate);
 let channel:BroadcastChannel|undefined;
 if(typeof BroadcastChannel!=='undefined'){
  try{channel=new BroadcastChannel(CHANNEL);channel.onmessage=event=>{if(event.data==='refresh')onInvalidate();};}catch{/* No persistent fallback. */}
 }
 return ()=>{if(includeLocal)window.removeEventListener(EVENT,onInvalidate);channel?.close();};
}
