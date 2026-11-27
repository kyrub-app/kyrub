import {adminDb} from '../firebaseAdmin.js';
import {requireOwnedFreelanceStore} from '../freelance/freelanceStoreRepresentationService.js';
import {normalizePersonalPixKey} from '../../shared/personalPixDestination.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
type Destination={schemaVersion:1;storeId:string;ownerUid:string;revision:number;status:'declared'|'revoked';updatedAt:string;keyType?:'email'|'random';key?:string};
const fail=():never=>{throw Error('FREELANCE_PIX_DESTINATION_CHANGED');};
const invalid=():never=>{throw Error('FREELANCE_INVALID');};
async function context(tx:FirebaseFirestore.Transaction,uid:string,storeId:string){
 if(!validFreelanceId(uid)||!validFreelanceId(storeId))return invalid();
 await requireOwnedFreelanceStore(tx,uid,storeId);
 const ref=adminDb.doc('storeFinancialDestinationsV1/'+storeId),d=(await tx.get(ref)).data() as Destination|undefined;
 if(d){
  if(d.schemaVersion!==1||d.storeId!==storeId||d.ownerUid!==uid||!Number.isSafeInteger(d.revision)||d.revision<1||!Number.isFinite(Date.parse(d.updatedAt))||!['declared','revoked'].includes(d.status)||Object.keys(d).length!==(d.status==='declared'?8:6))return fail();
  if(d.status==='declared'){
   if(!['email','random'].includes(d.keyType??''))return fail();
   const n=normalizePersonalPixKey({keyType:d.keyType,key:d.key});
   if(n.key!==d.key||n.keyType!==d.keyType)return fail();
  }else if(d.key!==undefined||d.keyType!==undefined)return fail();
 }
 return {ref,d};
}
function projection(d:Destination|undefined){
 return {revision:d?.revision??0,status:d?.status??'not_configured',ownershipVerified:false,...(d?.status==='declared'?{keyType:d.keyType,maskedKey:'••••'+d.key!.slice(-4)}:{})};
}
export async function readStoreRefundDestination(uid:string,storeId:string){
 return adminDb.runTransaction(async tx=>projection((await context(tx,uid,storeId)).d),{readOnly:true});
}
export async function changeStoreRefundDestination(uid:string,storeId:string,input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))return invalid();
 const b=input as Record<string,unknown>,revoke=b.action==='revoke';
 if((!revoke&&b.action!=='declare')||Object.keys(b).length!==(revoke?3:5)||Object.keys(b).some(k=>!(revoke?['action','expectedRevision','confirmed']:['action','expectedRevision','confirmed','destination','businessAccountDeclared']).includes(k))||b.confirmed!==true||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<0||(!revoke&&b.businessAccountDeclared!==true))return invalid();
 let key:{keyType:'email'|'random';key:string}|undefined;
 if(!revoke){try{const n=normalizePersonalPixKey(b.destination);if(n.keyType!=='email'&&n.keyType!=='random')return invalid();key={keyType:n.keyType,key:n.key};}catch{return invalid();}}
 return adminDb.runTransaction(async tx=>{
  const {ref,d}=await context(tx,uid,storeId),revision=d?.revision??0;
  if(revision!==b.expectedRevision||revision>=Number.MAX_SAFE_INTEGER||revoke&&d?.status!=='declared')return fail();
  if(!revoke){
   const identity=await tx.get(adminDb.doc('identity_verifications/'+uid)),roles=identity.get('approvedProfiles');
   if(identity.get('status')!=='approved'||!Array.isArray(roles)||!roles.includes('requester'))throw Error('IDENTITY_VERIFICATION_REQUIRED');
  }
  const next:Destination={schemaVersion:1,storeId,ownerUid:uid,revision:revision+1,status:revoke?'revoked':'declared',updatedAt:new Date().toISOString(),...key};
  tx.set(ref,next);return projection(next);
 });
}
/** Server-only, never falls back to the representative's personal destination. */
export async function readStoreRefundSecret(tx:FirebaseFirestore.Transaction,uid:string,storeId:string){
 const {d}=await context(tx,uid,storeId);
 if(d?.status!=='declared'||!d.key||!d.keyType)throw Error('FREELANCE_PIX_DESTINATION_REQUIRED');
 return {revision:d.revision,keyType:d.keyType,key:d.key,maskedKey:'••••'+d.key.slice(-4),ownershipVerified:false as const};
}
