import {auth} from './firebase';
import {requestReservedTribePilot as request} from './reservedTribePilotClient';
import {subscribeSocialPrivacyInvalidation} from './socialPrivacyInvalidation';

export type PilotRelation={id:string;senderId:string;receiverId:string;participantIds:string[];status:'pending'|'accepted';senderName?:string;receiverName?:string;senderRole?:string;receiverRole?:string;senderAvatar?:string;receiverAvatar?:string;senderBio?:string;receiverBio?:string};
export type PilotDirectory={revision:number;connections:PilotRelation[];favoriteIds:string[];tribes:{id:string;name:string;memberIds:string[]}[]};
export type PilotSuggestion={id:string;name:string;avatar:string;role:string;connectionStatus:'none'|'pending_sent';connectionId?:string};
export type PilotOrdinaryProjection={directory:PilotDirectory;suggestions:PilotSuggestion[]};

/** All consumers get only the server's ordinary projection. Clear before
 * refresh on invalidation; never retain stale data after loss of authority.
 * Local pilot only; no persisted data or fallback to Firestore. */
export function subscribePilotOrdinaryDirectory(owner:string,onChange:(value:PilotOrdinaryProjection|null)=>void,onError:(error:Error)=>void,includeSuggestions=false){
 let stopped=false,sequence=0,timer:number|undefined,controller:AbortController|null=null;
 const clear=()=>{++sequence;controller?.abort();controller=null;if(timer!==undefined)window.clearTimeout(timer);onChange(null);};
 const usable=()=>!stopped&&auth.currentUser?.uid===owner&&!document.hidden&&navigator.onLine!==false;
 const refresh=async()=>{
  if(!usable()){clear();return;}
  if(controller)return;
  const id=++sequence,abort=new AbortController();controller=abort;
  try{
   const directory=await request<PilotDirectory>('directory',{},abort.signal);
   const suggestions=includeSuggestions?await request<PilotSuggestion[]>('suggestions',{term:'',limit:30},abort.signal):[];
   // Confirm the revision after the separate suggestions request.
   const status=await request<{revision:number}>('status',{},abort.signal);
   if(usable()&&sequence===id&&!abort.signal.aborted){
    if(directory.revision!==status.revision)onChange(null);
    else onChange({directory,suggestions});
   }
  }catch{if(!stopped&&sequence===id&&!abort.signal.aborted){onChange(null);onError(Error('SOCIAL_DIRECTORY_UNAVAILABLE'));}}
  finally{if(sequence===id){controller=null;if(usable())timer=window.setTimeout(()=>void refresh(),5000);}}
 };
 const invalidate=()=>{clear();if(usable())void refresh();};
 const stopSignal=subscribeSocialPrivacyInvalidation(invalidate);
 const stopAuth=auth.onAuthStateChanged(user=>{if(user?.uid!==owner)clear();else invalidate();});
 document.addEventListener('visibilitychange',invalidate);
 window.addEventListener('offline',invalidate);window.addEventListener('online',invalidate);window.addEventListener('pagehide',clear);
 void refresh();
 return()=>{stopped=true;++sequence;controller?.abort();if(timer!==undefined)window.clearTimeout(timer);stopSignal();stopAuth();document.removeEventListener('visibilitychange',invalidate);window.removeEventListener('offline',invalidate);window.removeEventListener('online',invalidate);window.removeEventListener('pagehide',clear);};
}
