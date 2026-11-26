import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {auth,db} from './firebase';

const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
export function projectDiscoveredUser(id:string,data:Record<string,unknown>){
 if(data.isProfileVisible!==true)return null;
 const accountTypes=data.accountTypes as Record<string,unknown>|undefined;
 return {id,name:clean(data.name)||'Usuário Kyrub',photoUrl:clean(data.photoUrl),
  bio:clean(data.bio),role:clean(data.role)||(accountTypes?.lojista===true?'Lojista':accountTypes?.entregador===true?'Entregador':'Cliente'),
  isProfileVisible:true};
}
export function subscribeSocialDiscoveryDirectory(onUsers:(users:NonNullable<ReturnType<typeof projectDiscoveredUser>>[])=>void){
 const session=auth.currentUser;
 if(!session){onUsers([]);return ()=>{};}
 let active=true;
 const stop=onSnapshot(query(collection(db,'users'),where('isProfileVisible','==',true)),snapshot=>{
  if(!active||auth.currentUser!==session)return;
  onUsers(snapshot.docs.flatMap(item=>{const user=projectDiscoveredUser(item.id,item.data());return user?[user]:[];}));
 },()=>{if(active&&auth.currentUser===session)onUsers([]);});
 return ()=>{active=false;stop();};
}
