import {collection,onSnapshot,query,where} from 'firebase/firestore';
import {auth,db} from './firebase';
import type {User} from 'firebase/auth';
import {socialDirectoryPilotEnabled,readSocialDirectoryPilotPage} from './socialDirectoryPilot';

const clean=(value:unknown)=>typeof value==='string'?value.trim():'';
export function projectDiscoveredUser(id:string,data:Record<string,unknown>){
 if(data.isProfileVisible!==true)return null;
 const accountTypes=data.accountTypes as Record<string,unknown>|undefined;
 return {id,name:clean(data.name)||'Usuário Kyrub',photoUrl:clean(data.photoUrl),
  bio:clean(data.bio),role:clean(data.role)||(accountTypes?.lojista===true?'Lojista':accountTypes?.entregador===true?'Entregador':'Cliente'),
  isProfileVisible:true};
}
type DirectoryEntry=NonNullable<ReturnType<typeof projectDiscoveredUser>>;
export type SocialDirectoryPageState={loading:boolean;hasMore:boolean;error:boolean};
type Listener={onUsers:(users:DirectoryEntry[])=>void;onPage?:(state:SocialDirectoryPageState)=>void};
type PilotSession={user:User;listeners:Set<Listener>;entries:Map<string,DirectoryEntry>;cursor:string|null|undefined;
 loading:boolean;error:boolean;controller:AbortController;generation:number;stopAuth:()=>void};
let pilotSession:PilotSession|undefined;
function publishPilot(session:PilotSession){
 if(pilotSession!==session||auth.currentUser!==session.user)return;
 const entries=[...session.entries.values()];
 for(const listener of session.listeners){
  listener.onUsers(entries);
  listener.onPage?.({loading:session.loading,hasMore:session.cursor!==null,error:session.error});
 }
}
function disposePilot(session:PilotSession){
 session.controller.abort();session.stopAuth();session.listeners.clear();session.entries.clear();
 if(pilotSession===session)pilotSession=undefined;
}
async function loadPilotPage(session:PilotSession){
 if(pilotSession!==session||auth.currentUser!==session.user||session.loading||session.cursor===null)return;
 const generation=session.generation;
 session.loading=true;session.error=false;publishPilot(session);
 try{
  const result=await readSocialDirectoryPilotPage(session.user,session.cursor,session.controller.signal);
  if(pilotSession!==session||auth.currentUser!==session.user||generation!==session.generation)return;
  for(const entry of result.entries){
   if(entry.id!==session.user.uid)session.entries.set(entry.id,{...entry,bio:'',role:'Kairubido'});
  }
  session.cursor=result.nextCursor;
 }catch{
  if(pilotSession!==session||generation!==session.generation)return;
  // Drop cached identities after a failed protected request; no legacy fallback.
  session.entries.clear();session.cursor=undefined;session.error=true;
 }finally{
  if(pilotSession===session&&generation===session.generation){session.loading=false;publishPilot(session);}
 }
}
export function loadMoreSocialDiscoveryDirectory(){
 if(pilotSession)void loadPilotPage(pilotSession);
}
export function refreshSocialDiscoveryDirectory(){
 const session=pilotSession;
 if(!session||auth.currentUser!==session.user)return;
 session.controller.abort();session.controller=new AbortController();session.generation++;
 session.entries.clear();session.cursor=undefined;session.loading=false;session.error=false;
 void loadPilotPage(session);
}
function subscribePilotDirectory(user:User,listener:Listener){
 if(pilotSession&&pilotSession.user!==user)disposePilot(pilotSession);
 if(!pilotSession){
  const session:PilotSession={user,listeners:new Set(),entries:new Map(),cursor:undefined,loading:false,error:false,
   controller:new AbortController(),generation:0,stopAuth:()=>{}};
  pilotSession=session;
  session.stopAuth=auth.onAuthStateChanged(next=>{
   if(next!==user&&pilotSession===session){
    for(const item of session.listeners){item.onUsers([]);item.onPage?.({loading:false,hasMore:false,error:false});}
    disposePilot(session);
   }
  });
 }
 const session=pilotSession;
 session.listeners.add(listener);publishPilot(session);
 if(session.cursor===undefined&&!session.loading&&!session.error)void loadPilotPage(session);
 return ()=>{session.listeners.delete(listener);if(!session.listeners.size)disposePilot(session);};
}
export function subscribeSocialDiscoveryDirectory(onUsers:Listener['onUsers'],onPage?:Listener['onPage']){
 const session=auth.currentUser;
 if(!session){onUsers([]);onPage?.({loading:false,hasMore:false,error:false});return ()=>{};}
 if(socialDirectoryPilotEnabled())return subscribePilotDirectory(session,{onUsers,onPage});
 onPage?.({loading:false,hasMore:false,error:false});
 let active=true;
 const stop=onSnapshot(query(collection(db,'users'),where('isProfileVisible','==',true)),snapshot=>{
  if(!active||auth.currentUser!==session)return;
  onUsers(snapshot.docs.flatMap(item=>{const user=projectDiscoveredUser(item.id,item.data());return user?[user]:[];}));
 },()=>{if(active&&auth.currentUser===session)onUsers([]);});
 return ()=>{active=false;stop();};
}
