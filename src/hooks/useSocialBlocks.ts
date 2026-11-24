import {useEffect,useState} from 'react';
import {collection,onSnapshot} from 'firebase/firestore';
import {auth,db} from '../utils/firebase';
import {reservedTribePilotClientEnabled,requestReservedTribePilot} from '../utils/reservedTribePilotClient';
import {subscribePilotOrdinaryDirectory} from '../utils/pilotOrdinaryDirectory';
import {isConfirmedSocialSnapshot} from '../utils/socialSnapshotAuthority';
const key=(uid:string)=>'kyrub_blocked_users_'+uid;
const valid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export function legacySocialBlocks(uid:string):string[]{
 if(reservedTribePilotClientEnabled())return [];
 try{const list=JSON.parse(localStorage.getItem(key(uid))??'[]');return Array.isArray(list)?[...new Set(list.filter(valid))].filter(id=>id!==uid):[];}catch{return [];}
}
function removeLegacy(uid:string,id:string){
 if(reservedTribePilotClientEnabled())return;
 try{const remaining=legacySocialBlocks(uid).filter(value=>value!==id);if(remaining.length)localStorage.setItem(key(uid),JSON.stringify(remaining));else localStorage.removeItem(key(uid));}catch{}
}
export async function changeSocialBlock(id:string,blocked:boolean,expectedUid?:string){
 const user=auth.currentUser;
 if(!user||!valid(id)||user.uid===id||(expectedUid&&expectedUid!==user.uid))throw Error('AUTH_REQUIRED');
 if(reservedTribePilotClientEnabled()){
  const result=await requestReservedTribePilot<{blocked:boolean}>('social-block',{peerId:id,blocked});
  if(auth.currentUser!==user||result.blocked!==blocked)throw Error('BLOCK_UNAVAILABLE');
  return;
 }
 const token=await user.getIdToken();
 if(auth.currentUser?.uid!==user.uid)throw Error('SESSION_CHANGED');
 const response=await fetch('/api/health?transport=presentation-relationship&source=contact&id='+encodeURIComponent(id),{
  method:'POST',cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({action:blocked?'block':'unblock'})
 });
 if(!response.ok)throw Error('BLOCK_UNAVAILABLE');
 const value=await response.json() as {blocked?:boolean};
 if(value.blocked!==blocked||auth.currentUser?.uid!==user.uid)throw Error('BLOCK_UNAVAILABLE');
 removeLegacy(user.uid,id);
}
const running=new Set<string>();
export async function migrateLegacySocialBlocks(uid:string){
 if(reservedTribePilotClientEnabled()||running.has(uid)||auth.currentUser?.uid!==uid)return;
 running.add(uid);
 try{
  for(const id of legacySocialBlocks(uid).slice(0,100)){
   if(auth.currentUser?.uid!==uid)return;
   try{await changeSocialBlock(id,true,uid);}catch{/* Keep unconfirmed entries for retry. */}
  }
 }finally{running.delete(uid);}
}
export function useSocialBlocks(uid:string|undefined){
 const pilot=reservedTribePilotClientEnabled();
 const [snapshot,setSnapshot]=useState<{uid:string;entries:{id:string;name:string}[];ready:boolean}>({uid:'',entries:[],ready:false});
 useEffect(()=>{
  if(!uid){setSnapshot({uid:'',entries:[],ready:false});return;}
  setSnapshot({uid,entries:[],ready:false});
  if(pilot)return subscribePilotOrdinaryDirectory(uid,value=>{
   if(!value||auth.currentUser?.uid!==uid){setSnapshot({uid,entries:[],ready:false});return;}
   setSnapshot({uid,entries:value.directory.blockedContacts,ready:true});
  },()=>setSnapshot({uid,entries:[],ready:false}));
  return onSnapshot(collection(db,'social_contact_blocks',uid,'blocked'),{includeMetadataChanges:true},result=>{
   if(!isConfirmedSocialSnapshot(result.metadata,uid,auth.currentUser?.uid)){setSnapshot({uid,entries:[],ready:false});return;}
   setSnapshot({uid,ready:true,entries:result.docs.map(doc=>({id:doc.id,name:typeof doc.get('name')==='string'?doc.get('name'):'Kairubido'}))});
  },()=>setSnapshot({uid,entries:[],ready:false}));
 },[uid,pilot]);
 const ready=!!uid&&auth.currentUser?.uid===uid&&snapshot.uid===uid&&snapshot.ready;
 return {entries:ready?snapshot.entries:[],ready};
}
