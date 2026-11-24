import {useEffect,useState} from 'react';
import {collection,onSnapshot} from 'firebase/firestore';
import {auth,db} from '../utils/firebase';
const key=(uid:string)=>'kyrub_blocked_users_'+uid;
const valid=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
export function legacySocialBlocks(uid:string):string[]{
 try{const list=JSON.parse(localStorage.getItem(key(uid))??'[]');return Array.isArray(list)?[...new Set(list.filter(valid))].filter(id=>id!==uid):[];}catch{return [];}
}
function removeLegacy(uid:string,id:string){
 try{const remaining=legacySocialBlocks(uid).filter(value=>value!==id);if(remaining.length)localStorage.setItem(key(uid),JSON.stringify(remaining));else localStorage.removeItem(key(uid));}catch{}
}
export async function changeSocialBlock(id:string,blocked:boolean,expectedUid?:string){
 const user=auth.currentUser;
 if(!user||!valid(id)||user.uid===id||(expectedUid&&expectedUid!==user.uid))throw Error('AUTH_REQUIRED');
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
 if(running.has(uid)||auth.currentUser?.uid!==uid)return;
 running.add(uid);
 try{
  for(const id of legacySocialBlocks(uid).slice(0,100)){
   if(auth.currentUser?.uid!==uid)return;
   try{await changeSocialBlock(id,true,uid);}catch{/* Keep unconfirmed entries for retry. */}
  }
 }finally{running.delete(uid);}
}
export function useSocialBlocks(uid:string|undefined){
 const [snapshot,setSnapshot]=useState<{uid:string;entries:{id:string;name:string}[];ready:boolean}>({uid:'',entries:[],ready:false});
 useEffect(()=>{
  if(!uid){setSnapshot({uid:'',entries:[],ready:false});return;}
  setSnapshot({uid,entries:[],ready:false});
  return onSnapshot(collection(db,'social_contact_blocks',uid,'blocked'),result=>{
   if(auth.currentUser?.uid!==uid)return;
   setSnapshot({uid,ready:!result.metadata.fromCache,entries:result.docs.map(doc=>({id:doc.id,name:typeof doc.get('name')==='string'?doc.get('name'):'Kairubido'}))});
  },()=>setSnapshot({uid,entries:[],ready:false}));
 },[uid]);
 return {entries:snapshot.uid===uid?snapshot.entries:[],ready:snapshot.uid===uid&&snapshot.ready};
}
