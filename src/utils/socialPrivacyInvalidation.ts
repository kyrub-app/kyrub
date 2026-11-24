// No identity, session, reason, count or contact information is shared.
// This signal is an invalidation hint, never evidence of authorization.
// No localStorage fallback: unsupported browsers recheck the server.
const EVENT='kyrub:social-privacy-invalidate';
const CHANNEL='kyrub-social-privacy-v1';
// BroadcastChannel excludes the sending object, not the sending document.
// Share ONE channel per module/document, so local subscribers cannot receive
// their own broadcast via a second channel. The local event handles opt-in.
let sharedChannel:BroadcastChannel|undefined;
let listeners=0;
function openChannel():BroadcastChannel|undefined{
 if(typeof BroadcastChannel==='undefined')return undefined;
 try{return new BroadcastChannel(CHANNEL);}catch{return undefined;}
}
export function publishSocialPrivacyInvalidation(){
 if(typeof window==='undefined')return;
 window.dispatchEvent(new Event(EVENT));
 const channel=sharedChannel??openChannel();
 try{channel?.postMessage('refresh');}catch{/* Server polling remains the authority. */}
 finally{if(channel&&channel!==sharedChannel)channel.close();}
}
export function subscribeSocialPrivacyInvalidation(onInvalidate:()=>void,includeLocal=true){
 if(typeof window==='undefined')return ()=>{};
 if(includeLocal)window.addEventListener(EVENT,onInvalidate);
 const channel=sharedChannel??openChannel();
 const receive=(event:MessageEvent)=>{if(event.data==='refresh')onInvalidate();};
 if(channel){sharedChannel=channel;listeners++;channel.addEventListener('message',receive);}
 let stopped=false;
 return ()=>{
  if(stopped)return;stopped=true;
  if(includeLocal)window.removeEventListener(EVENT,onInvalidate);
  if(channel){
   channel.removeEventListener('message',receive);
   if(--listeners===0){channel.close();sharedChannel=undefined;}
  }
 };
}
