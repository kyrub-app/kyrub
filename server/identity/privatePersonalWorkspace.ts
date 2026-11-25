import { randomUUID } from 'node:crypto';
import { adminAuth, adminDb } from '../firebaseAdmin.js';
import { evaluateStoredCapabilityAgeAccess } from '../../shared/ageEligibility.js';
import { ageScreeningEmulatorsReady } from './ageScreeningRouter.js';
type Item = { id:string; text:string; done:boolean };
type Kind = 'notes'|'tasks';
const workspace = 'restricted_personal_preview';
/** Isolated prototype only. Existing shared notes/tasks remain untouched. */
export async function privatePersonalWorkspace(authorization:string, kind:Kind, input?:unknown) {
 if(!ageScreeningEmulatorsReady(process.env)||process.env.KYRUB_PERSONAL_PREVIEW_ENABLED!=='true')throw Error('PERSONAL_UNAVAILABLE');
 if(kind!=='notes'&&kind!=='tasks')throw Error('PERSONAL_INVALID');
 const token=/^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
 if(!token||token.length>8192)throw Error('PERSONAL_AUTH_REQUIRED');
 const identity=await adminAuth.verifyIdToken(token,true);
 const uid=identity.uid;
 if(identity.email_verified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(uid))throw Error('PERSONAL_AUTH_REQUIRED');
 const ref=adminDb.collection(workspace).doc(uid+'_'+kind);
 const ageRef=adminDb.doc('age_eligibility_private/'+uid);
 return adminDb.runTransaction(async tx=>{
  const [age,record]=await Promise.all([tx.get(ageRef),tx.get(ref)]);
  if(!evaluateStoredCapabilityAgeAccess({actorUid:uid,record:age.data(),capability:kind==='notes'?'private_notes':'private_tasks',policy:'reviewed_personal_only'}))throw Error('PERSONAL_FORBIDDEN');
  if(record.exists&&record.get('uid')!==uid)throw Error('PERSONAL_FORBIDDEN');
  const items=(record.get('items')??[]) as Item[];
  if(!Array.isArray(items)||items.length>50)throw Error('PERSONAL_INVALID');
  if(input===undefined)return {items};
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('PERSONAL_INVALID');
  const data=input as Record<string,unknown>;
  let updated:Item[];
  if(data.action==='create'&&Object.keys(data).length===2&&typeof data.text==='string'&&data.text.trim()&&data.text.length<=1000&&items.length<50){
   updated=[...items,{id:randomUUID(),text:data.text.trim(),done:false}];
  }else if(data.action==='delete'&&Object.keys(data).length===2&&typeof data.id==='string'&&items.some(x=>x.id===data.id)){
   updated=items.filter(x=>x.id!==data.id);
  }else if(data.action==='update'&&typeof data.id==='string'&&typeof data.text==='string'&&data.text.trim()&&data.text.length<=1000&&typeof data.done==='boolean'&&Object.keys(data).length===4&&items.some(x=>x.id===data.id)&&(kind==='tasks'||data.done===false)){
   updated=items.map(x=>x.id===data.id?{id:x.id,text:(data.text as string).trim(),done:data.done as boolean}:x);
  }else throw Error('PERSONAL_INVALID');
  tx.set(ref,{uid,kind,items:updated});
  return {items:updated};
 });
}
