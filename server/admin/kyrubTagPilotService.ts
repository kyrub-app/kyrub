import {randomBytes} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {adminAuth,adminDb} from '../firebaseAdmin.js';
import {hashKyrubTagActivation} from '../identity/kyrubTagService.js';
import {isTagId,tagUrl} from '../../shared/kyrubTagContract.js';
const batch='experimental-001';
const slot='001';
const slotRef=()=>adminDb.doc('kyrub_tag_pilot_lots/'+batch+'/units/'+slot);
const roleRef=(actor:string)=>adminDb.doc('kyrub_admin/control_plane/admins/'+actor);
function assertRole(actor:string,role:FirebaseFirestore.DocumentData|undefined){
 if(!role||role.uid!==actor||role.role!=='super_admin'||role.status!=='active')throw Error('FORBIDDEN');
}
export async function authorizePilot(authorization:string){
 const token=/^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
 if(!token||token.length>8192)throw Error('AUTH_REQUIRED');
 const decoded=await adminAuth.verifyIdToken(token,true);
 if(decoded.email_verified!==true||!/^[A-Za-z0-9_-]{1,128}$/.test(decoded.uid))throw Error('FORBIDDEN');
 return decoded.uid;
}
function project(id:string,data:FirebaseFirestore.DocumentData|undefined){
 if(!isTagId(id)||!data||data.pilotBatch!==batch||data.pilotSlot!==slot||data.model!=='adesivo'||!(data.ownerId===null||typeof data.ownerId==='string'))throw Error('PILOT_UNAVAILABLE');
 return {id,url:tagUrl(id),claimed:data.ownerId!==null,model:'adesivo' as const,batch,slot,experimental:true};
}
export async function readPilot(actor:string){
 return adminDb.runTransaction(async tx=>{
  const [role,record]=await Promise.all([tx.get(roleRef(actor)),tx.get(slotRef())]);
  assertRole(actor,role.data());
  if(!record.exists)return {unit:null};
  const id=record.get('tagId');
  if(!isTagId(id))throw Error('PILOT_UNAVAILABLE');
  const tag=await tx.get(adminDb.doc('kyrub_official_tags/'+id));
  return {unit:project(id,tag.data())};
 });
}
export async function mutatePilot(actor:string,action:unknown){
 if(action!=='issue'&&action!=='replace-code')throw Error('PILOT_INVALID');
 const proposedId=randomBytes(16).toString('hex'),code=randomBytes(16).toString('hex'),auditId=randomBytes(16).toString('hex');
 return adminDb.runTransaction(async tx=>{
  const [role,record]=await Promise.all([tx.get(roleRef(actor)),tx.get(slotRef())]);
  assertRole(actor,role.data());
  if(action==='issue'&&record.exists)throw Error('PILOT_EXISTS');
  if(action==='replace-code'&&!record.exists)throw Error('PILOT_NOT_FOUND');
  const id=action==='issue'?proposedId:record.get('tagId');
  if(!isTagId(id))throw Error('PILOT_UNAVAILABLE');
  const ref=adminDb.doc('kyrub_official_tags/'+id);
  const tag=await tx.get(ref);
  let result;
  if(action==='issue'){
   if(tag.exists)throw Error('PILOT_UNAVAILABLE');
   const data={model:'adesivo',ownerId:null,enabled:false,targets:[],activationHash:hashKyrubTagActivation(id,code),createdAt:FieldValue.serverTimestamp(),pilotBatch:batch,pilotSlot:slot};
   tx.create(ref,data);
   tx.create(slotRef(),{tagId:id,batch,slot,createdAt:FieldValue.serverTimestamp()});
   result=project(id,data);
  }else{
   result=project(id,tag.data());
   if(result.claimed||tag.get('enabled')!==false)throw Error('PILOT_ALREADY_CLAIMED');
   tx.update(ref,{activationHash:hashKyrubTagActivation(id,code)});
  }
  tx.create(adminDb.doc('kyrub_admin/control_plane/audit_logs/'+auditId),{id:auditId,action:action==='issue'?'admin.kyrub_tag.pilot.issued':'admin.kyrub_tag.pilot.code_replaced',actorId:actor,actorRole:'super_admin',targetType:'kyrub_tag',targetId:id,batch,slot,source:'server',createdAt:FieldValue.serverTimestamp()});
  // Secret is returned only to the authorized caller; never stored in plaintext.
  return {unit:result,code};
 });
}
export async function handlePilot(authorization:string,method:string,body:unknown){
 try{
  if(method!=='GET'&&method!=='POST')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
  const actor=await authorizePilot(authorization);
  if(method==='GET')return {status:200,body:await readPilot(actor)};
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!('action' in body))throw Error('PILOT_INVALID');
  return {status:200,body:await mutatePilot(actor,body.action)};
 }catch(error){
  const message=error instanceof Error?error.message:'',code=(error as {code?:string})?.code??'';
  if(message==='AUTH_REQUIRED'||/^auth\/(argument-error|invalid-id-token|id-token-expired|id-token-revoked|user-disabled|user-not-found|invalid-credential)$/.test(code))return {status:401,body:{error:'AUTH_REQUIRED'}};
  if(message==='FORBIDDEN')return {status:403,body:{error:'FORBIDDEN'}};
  if(message==='PILOT_INVALID')return {status:400,body:{error:message}};
  if(['PILOT_EXISTS','PILOT_NOT_FOUND','PILOT_ALREADY_CLAIMED'].includes(message))return {status:409,body:{error:message}};
  return {status:503,body:{error:'PILOT_UNAVAILABLE'}};
 }
}
