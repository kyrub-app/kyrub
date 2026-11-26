import type {Auth} from 'firebase-admin/auth';
import {FieldPath,type Firestore} from 'firebase-admin/firestore';
import {isDocumentId} from './publicSocialAddressPolicy.js';

const PAGE_SIZE=40;
const clean=(value:unknown,max:number)=>typeof value==='string'?value.trim().slice(0,max):'';

export function projectVisibleDirectoryEntry(uid:string,source:Record<string,unknown>){
 if(!isDocumentId(uid)||source.uid!==uid||source.isProfileVisible!==true)return null;
 const photoUrl=clean(source.photoUrl,2048);
 return {id:uid,name:clean(source.name,160)||'Usuário Kyrub',
  photoUrl:/^https:\/\//i.test(photoUrl)?photoUrl:'',isProfileVisible:true as const};
}

/** Server-only read service. No deployed route or migration yet. Select only
 * necessary fields at source; never return email, civil identity or contact
 * data. Cursor is the last examined document, not the last emitted entry.
 * Caller must establish an authenticated actor and enforce request quotas. */
export async function readVisibleSocialDirectoryPage(db:Firestore,actorUid:string,after?:string){
 if(!isDocumentId(actorUid)||(after!==undefined&&!isDocumentId(after)))throw Error('DIRECTORY_INPUT_INVALID');
 let query=db.collection('users').where('isProfileVisible','==',true)
  .orderBy(FieldPath.documentId()).select('uid','name','photoUrl','isProfileVisible').limit(PAGE_SIZE+1);
 if(after!==undefined)query=query.startAfter(after);
 const snapshot=await query.get();
 const examined=snapshot.docs.slice(0,PAGE_SIZE);
 return {entries:examined.flatMap(doc=>{
  if(doc.id===actorUid)return [];
  const entry=projectVisibleDirectoryEntry(doc.id,doc.data());
  return entry?[entry]:[];
 }),nextCursor:snapshot.size>PAGE_SIZE?examined[examined.length-1].id:null};
}

/** Bounded identity hydration for existing post presentation. Private or
 * inconsistent profiles are not returned; callers retain saved attribution.
 * An arbitrary UID is not proof of permission to read a reserved profile. */
export async function readVisibleAuthorIdentities(db:Firestore,actorUid:string,authorIds:unknown){
 if(!isDocumentId(actorUid)||!Array.isArray(authorIds)||authorIds.length>40||
    authorIds.some(id=>!isDocumentId(id)))throw Error('DIRECTORY_INPUT_INVALID');
 const ids=[...new Set(authorIds as string[])];
 if(!ids.length)return [];
 const snapshots=await db.getAll(...ids.map(uid=>db.doc('users/'+uid)),{
  fieldMask:['uid','name','photoUrl','isProfileVisible']
 });
 return snapshots.flatMap(doc=>{
  const data=doc.data();
  if(!data)return [];
  const entry=projectVisibleDirectoryEntry(doc.id,data);
  return entry?[{id:entry.id,name:entry.name,avatar:entry.photoUrl}]:[];
 });
}

/** Exact collaborator lookup. Auth owns email-to-UID binding; a mutable
 * account document's email is never a search credential or response field.
 * Both name and email lookup respect explicit social visibility. */
export async function searchVisibleNoteCollaborators(db:Firestore,auth:Auth,actorUid:string,term:unknown){
 if(!isDocumentId(actorUid)||typeof term!=='string'||term.trim().length<3||term.trim().length>254)
  throw Error('DIRECTORY_INPUT_INVALID');
 const search=term.trim();
 const fields=['uid','name','photoUrl','isProfileVisible'];
 if(search.includes('@')){
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search))throw Error('DIRECTORY_INPUT_INVALID');
  let target;
  try{target=await auth.getUserByEmail(search.toLowerCase());}
  catch(error){if((error as {code?:string}).code==='auth/user-not-found')return [];throw error;}
  if(target.disabled||!target.emailVerified||target.uid===actorUid||!isDocumentId(target.uid))return [];
  const [snapshot]=await db.getAll(db.doc('users/'+target.uid),{fieldMask:fields});
  const data=snapshot.data(),entry=data?projectVisibleDirectoryEntry(target.uid,data):null;
  return entry?[entry]:[];
 }
 const snapshot=await db.collection('users').where('name','==',search).where('isProfileVisible','==',true)
  .select(...fields).limit(10).get();
 const candidates=snapshot.docs.flatMap(doc=>{
  const entry=projectVisibleDirectoryEntry(doc.id,doc.data());
  return entry&&entry.id!==actorUid?[entry]:[];
 });
 if(!candidates.length)return [];
 const users=await auth.getUsers(candidates.map(entry=>({uid:entry.id})));
 const allowed=new Set(users.users.filter(user=>!user.disabled&&user.emailVerified).map(user=>user.uid));
 return candidates.filter(entry=>allowed.has(entry.id));
}
