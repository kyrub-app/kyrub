import {randomBytes} from 'node:crypto';
import {FieldValue} from 'firebase-admin/firestore';
import {adminDb} from '../firebaseAdmin.js';
import {authorizePilot} from './kyrubTagPilotService.js';
import {tagUrl} from '../../shared/kyrubTagContract.js';
import {EMPTY_PROMOTIONAL_PRESENTATION} from '../../shared/kyrubTagPromotional.js';
import {assertTagPilotWriteIsolated,currentTagPilotIsolation,tagPilotClientMatchesServer} from '../identity/kyrubTagPilotIsolation.js';

const batchDocs=()=>adminDb.collection('kyrub_tag_promotional_batches');
const adminRole=(uid:string)=>adminDb.doc('kyrub_admin/control_plane/admins/'+uid);
const auditCollection=()=>adminDb.collection('kyrub_admin/control_plane/audit_logs');
const enabled=()=>process.env.KYRUB_TAG_PROMO_ISSUANCE_ENABLED==='true';
const batchIdValid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const unitId=()=>randomBytes(16).toString('hex');
const projectBatch=(id:string,data:FirebaseFirestore.DocumentData)=>{
 const tagIds=data.tagIds;
 if(!batchIdValid(id)||data.mode!=='promotional'||data.model!=='adesivo'||
  !Array.isArray(tagIds)||tagIds.length<1||tagIds.length>10||
  tagIds.some(v=>typeof v!=='string'||!/^[a-f0-9]{32}$/.test(v))||
  new Set(tagIds).size!==tagIds.length)throw Error('TAG_BATCH_CORRUPT');
 return {id,model:'adesivo' as const,count:tagIds.length,units:tagIds.map(tagId=>({
  id:tagId,url:tagUrl(tagId),
  physicalStatus:data.readbackReports?.[tagId]?.status==='browser_readback_confirmed'
    ? 'readback_confirmed' as const:'not_verified' as const
 }))};
};
function assertRole(uid:string,role:FirebaseFirestore.DocumentData|undefined){
 if(!role||role.uid!==uid||role.role!=='super_admin'||role.status!=='active')throw Error('FORBIDDEN');
}

function pilotReadiness(){
 const isolation=currentTagPilotIsolation();
 return {
  isolation,
  productionDataProtected:isolation==='unsafe',
  clientProjectMatchesServer:isolation!=='unsafe'&&tagPilotClientMatchesServer(),
  issuanceEnabled:enabled(),
  activationEnabled:process.env.KYRUB_TAG_PROMO_FIRST_CLAIM_ENABLED==='true',
  minimalIdentityGateConfigured:process.env.VITE_KYRUB_TAG_MINIMAL_IDENTITY_GATE==='true',
  emailLinkProvider:'manual-verification-required' as const,
  storageRulesPublished:'manual-verification-required' as const,
  physicalNfcVerified:false,
  canIssue:isolation!=='unsafe'&&tagPilotClientMatchesServer()&&enabled()
 };
}

/** Super Admin read-only inventory. No recipient identity or secret is stored. */
export async function listPromotionalBatches(uid:string){
 const role=await adminRole(uid).get();
 assertRole(uid,role.data());
 const records=await batchDocs().orderBy('createdAt','desc').limit(20).get();
 return {readiness:pilotReadiness(),batches:records.docs.map(d=>projectBatch(d.id,d.data()))};
}
/**
 * Only pre-registers NFC URLs. It does NOT attest a physical chip or publish
 * a unit. The requestId is a 128-bit client nonce; replay never issues twice.
 */
export async function issuePromotionalBatch(uid:string,count:unknown,requestId:unknown){
 assertTagPilotWriteIsolated();
 if(!enabled())throw Error('TAG_BATCH_DISABLED');
 if(!Number.isInteger(count)||typeof count!=='number'||count<1||count>10||!batchIdValid(requestId))throw Error('TAG_BATCH_INVALID');
 const ids=Array.from({length:count},unitId),auditId=unitId(),ref=batchDocs().doc(requestId);
 return adminDb.runTransaction(async tx=>{
  const [role,existing]=await Promise.all([tx.get(adminRole(uid)),tx.get(ref)]);
  assertRole(uid,role.data());
  if(existing.exists){
   const original=projectBatch(requestId,existing.data()!);
   if(original.count!==count)throw Error('TAG_BATCH_CONFLICT');
   return {batch:original,replay:true};
  }
  const stamp=FieldValue.serverTimestamp();
  tx.create(ref,{mode:'promotional',model:'adesivo',tagIds:ids,count,createdBy:uid,createdAt:stamp});
  for(const id of ids){
   tx.create(adminDb.collection('kyrub_official_tags').doc(id),{
    model:'adesivo',distribution:'promotional',ownerId:null,enabled:false,blocked:false,
    activationHash:null,reservedEmailHash:null,targets:[],externalUrls:[],
    presentation:EMPTY_PROMOTIONAL_PRESENTATION,promotionalBatchId:requestId,
    createdAt:stamp
   });
  }
  tx.create(auditCollection().doc(auditId),{
   id:auditId,action:'admin.kyrub_tag.promotional_batch_issued',actorId:uid,
   actorRole:'super_admin',targetType:'kyrub_tag_promotional_batch',
   targetId:requestId,count,source:'server',createdAt:stamp
  });
  return {batch:projectBatch(requestId,{mode:'promotional',model:'adesivo',tagIds:ids}),replay:false};
 });
}
/**
 * Records a BROWSER-REPORTED readback, not a cryptographically authenticated
 * tag UID. The actual NDEF scan happens on the operator's Android device.
 * The server independently confirms that the reported URL points to the
 * current branch preview and was issued in this batch.
 */
export async function confirmPromotionalTagReadback(
 uid:string,batchId:unknown,tagId:unknown,readUrl:unknown
){
 assertTagPilotWriteIsolated();
 if(!batchIdValid(batchId)||!batchIdValid(tagId)||
    typeof readUrl!=='string'||readUrl.length>512)throw Error('TAG_BATCH_INVALID');
 const expectedHost=process.env.VERCEL_URL?.trim().toLowerCase();
 const isolation=currentTagPilotIsolation();
 if(!['isolated-project','emulator'].includes(isolation)||!expectedHost||!expectedHost.endsWith('.vercel.app'))
  throw Error('TAG_PILOT_PROJECT_UNSAFE');
 let url:URL;
 try{url=new URL(readUrl);}catch{throw Error('TAG_BATCH_INVALID');}
 if(url.protocol!=='https:'||url.hostname!==expectedHost||url.port||url.username||
    url.password||url.search||url.hash||url.pathname!=='/tag/'+tagId)
    throw Error('TAG_READBACK_MISMATCH');
 const batch=batchDocs().doc(batchId),unit=adminDb.collection('kyrub_official_tags').doc(tagId);
 return adminDb.runTransaction(async tx=>{
  const [role,batchSnapshot,unitSnapshot]=await Promise.all([
   tx.get(adminRole(uid)),tx.get(batch),tx.get(unit)
  ]);
  assertRole(uid,role.data());
  const bd=batchSnapshot.data(),td=unitSnapshot.data();
  if(!bd||!td||bd.mode!=='promotional'||bd.model!=='adesivo'||
    !Array.isArray(bd.tagIds)||!bd.tagIds.includes(tagId)||
    td.distribution!=='promotional'||td.promotionalBatchId!==batchId||
    td.ownerId!==null||td.enabled!==false||td.blocked===true)
   throw Error('TAG_BATCH_CONFLICT');
  if(bd.readbackReports?.[tagId]?.status==='browser_readback_confirmed')
   return {batch:projectBatch(batchId,bd),replay:true};
  const verifiedAt=new Date().toISOString();
  tx.update(batch,{['readbackReports.'+tagId]:{
   status:'browser_readback_confirmed',verifiedAt,verifiedBy:uid,
   verificationMethod:'browser-reported-ndef-readback',
   previewHost:expectedHost
  }});
  const next={...bd,readbackReports:{...(bd.readbackReports??{}),
   [tagId]:{status:'browser_readback_confirmed'}}};
  return {batch:projectBatch(batchId,next),replay:false};
 });
}

export async function handlePromotionalBatch(authorization:string,method:string,body:unknown){
 try{
  if(method!=='GET'&&method!=='POST')return {status:405,body:{error:'METHOD_NOT_ALLOWED'}};
  const uid=await authorizePilot(authorization);
  if(method==='GET')return {status:200,body:await listPromotionalBatches(uid)};
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('TAG_BATCH_INVALID');
  const b=body as Record<string,unknown>;
  if(b.action==='confirm-readback'&&Object.keys(b).length===4){
   const result=await confirmPromotionalTagReadback(uid,b.batchId,b.tagId,b.readUrl);
   return {status:200,body:result};
  }
  if(b.action!=='issue'||Object.keys(b).length!==3)throw Error('TAG_BATCH_INVALID');
  const result=await issuePromotionalBatch(uid,b.count,b.requestId);
  return {status:result.replay?200:201,body:result};
 }catch(error){
  const message=error instanceof Error?error.message:'',code=(error as {code?:string})?.code??'';
  if(message==='AUTH_REQUIRED'||/^auth\/(argument-error|invalid-id-token|id-token-expired|id-token-revoked|user-disabled|user-not-found|invalid-credential)$/.test(code))
   return {status:401,body:{error:'AUTH_REQUIRED'}};
  if(message==='FORBIDDEN')return {status:403,body:{error:'FORBIDDEN'}};
  if(message==='TAG_BATCH_INVALID')return {status:400,body:{error:message}};
  if(['TAG_BATCH_DISABLED','TAG_BATCH_CONFLICT','TAG_PILOT_PROJECT_UNSAFE','TAG_READBACK_MISMATCH'].includes(message))return {status:409,body:{error:message}};
  return {status:503,body:{error:'TAG_BATCH_UNAVAILABLE'}};
 }
}
