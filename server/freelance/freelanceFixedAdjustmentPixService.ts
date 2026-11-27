import {adminDb} from '../firebaseAdmin.js';
import {readAdjustmentStatementContext} from './freelanceFixedAdjustmentStatementService.js';
import {readPersonalPixForContract,readPersonalPixSecretForContract} from '../payments/personalPixDestinationService.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
const conflict=():never=>{throw Error('FREELANCE_PIX_DESTINATION_CHANGED');};
const blocked=():never=>{throw Error('FREELANCE_PIX_DISCLOSURE_UNAVAILABLE');};
type Consent={schemaVersion:1;offerId:string;sourceDigest:string;recipientUid:string;payerUid:string;revision:number;keyType:string;authorizedAt:string;revokedAt?:string};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
async function context(tx:FirebaseFirestore.Transaction,uid:string,id:string){
 const financial=await readAdjustmentStatementContext(tx,uid,id),{c,o}=financial;
 // A recipient's isolated nonreceipt is not a declaration that payment was sent.
 // Any paid/received statement, review, or inconsistent financial source fails closed.
 const paymentBlocked=!!financial.queue||!['awaiting_payment','nonreceipt_reported'].includes(financial.projection.state);
 const consentRef=c.direct.doc('fixedAdjustmentPixConsent'),accessRef=c.direct.doc('fixedAdjustmentPixDisclosure');
 const [saved,access]=await tx.getAll(consentRef,accessRef);
 const consent=saved.data() as Consent|undefined;
 if(consent&&(
 Object.keys(consent).length!==(consent.revokedAt===undefined?8:9)||consent.schemaVersion!==1||consent.offerId!==id||consent.sourceDigest!==o.sourceDigest||consent.recipientUid!==o.recipientUid||consent.payerUid!==o.payerUid||!Number.isSafeInteger(consent.revision)||consent.revision<1||!['cpf','email','phone','random'].includes(consent.keyType)||!iso(consent.authorizedAt)||Date.parse(consent.authorizedAt)<Date.parse(o.dueAt)||(consent.revokedAt!==undefined&&(!iso(consent.revokedAt)||Date.parse(consent.revokedAt)<Date.parse(consent.authorizedAt)))))return conflict();
 const a=access.data();
 if(a&&(!consent||Object.keys(a).length!==7||a.schemaVersion!==1||a.offerId!==id||a.sourceDigest!==o.sourceDigest||a.payerUid!==o.payerUid||a.revision!==consent.revision||a.amountMinor!==o.amountMinor||!iso(a.firstAccessAt)||Date.parse(a.firstAccessAt)<Date.parse(consent.authorizedAt)||(consent.revokedAt!==undefined&&Date.parse(a.firstAccessAt)>Date.parse(consent.revokedAt))))return conflict();
 return {c,o,consent,consentRef,accessRef,access:a,paymentBlocked,financialState:financial.projection.state,storeRefund:o.direction==='refund'&&!!o.requesterStoreId};
}
async function eligible(tx:FirebaseFirestore.Transaction,o:NonNullable<Awaited<ReturnType<typeof context>>['o']>){
 const docs=await tx.getAll(adminDb.doc('identity_verifications/'+o.originalRequesterUid),adminDb.doc('identity_verifications/'+o.originalBeneficiaryUid));
 for(const [i,role] of ['requester','freelancer'].entries()){const d=docs[i],roles=d.get('approvedProfiles');if(d.get('status')!=='approved'||!Array.isArray(roles)||!roles.includes(role))throw Error('IDENTITY_VERIFICATION_REQUIRED');}
}
export async function readAdjustmentPix(uid:string,id:string){
 if(!validFreelanceId(uid)||!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await context(tx,uid,id),{o,consent}=x,role=uid===o.recipientUid?'recipient':'payer';
  let destination:null|Awaited<ReturnType<typeof readPersonalPixForContract>>=null;
  // Only the recipient may see a candidate before consent. Payer sees no key metadata without consent.
  if(!x.storeRefund&&!x.paymentBlocked&&(role==='recipient'||consent&&!consent.revokedAt)){
   try{destination=await readPersonalPixForContract(tx,o.recipientUid);}catch(e){if(!(e instanceof Error)||e.message!=='FREELANCE_PIX_DESTINATION_REQUIRED')throw e;}
  }
  const current=!!destination&&(!consent||destination.revision===consent.revision&&destination.keyType===consent.keyType);
  return {offerId:id,sourceDigest:o.sourceDigest,direction:o.direction,amountMinor:o.amountMinor,role,storeRefund:x.storeRefund,consentRevision:consent?.revision??null,authorized:!!consent&&!consent.revokedAt,revoked:!!consent?.revokedAt,disclosed:!!x.access,blocked:x.paymentBlocked||x.storeRefund,financialState:x.financialState, destination:current?destination:null,bankVerified:false};
 },{readOnly:true});
}
export async function changeAdjustmentPix(uid:string,id:string,action:'authorize'|'revoke'|'reveal',input:{sourceDigest:unknown;expectedAmountMinor:unknown;expectedRevision:unknown;confirmed:unknown;paymentNotSent?:unknown}){
 if(!validFreelanceId(uid)||!validFreelanceId(id)||input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest)||!Number.isSafeInteger(input.expectedAmountMinor)||Number(input.expectedAmountMinor)<1||!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<1||(action==='reveal'&&input.paymentNotSent!==true))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const x=await context(tx,uid,id),{o,consent}=x,revision=Number(input.expectedRevision);
  if(uid!==(action==='reveal'?o.payerUid:o.recipientUid))throw Error('FREELANCE_FORBIDDEN');
  if(input.sourceDigest!==o.sourceDigest||input.expectedAmountMinor!==o.amountMinor)return conflict();
  const now=new Date().toISOString();
  if(action==='revoke'){
   if(!consent||consent.revision!==revision||Date.parse(now)<Date.parse(consent.authorizedAt))return conflict();
   if(consent.revokedAt)return {changed:false};
   tx.update(x.consentRef,{revokedAt:now});
   writeFreelanceFinancialNotices(tx,x.c.obligation,'fixed_cancellation_adjustment_pix_revoked',now,o.payerUid===o.originalRequesterUid?'requester':'freelancer',o.sourceDigest);
   return {changed:true};
  }
  if(x.storeRefund||x.paymentBlocked)return blocked();
  await eligible(tx,o);
  const destination=await readPersonalPixSecretForContract(tx,o.recipientUid);
  if(destination.revision!==revision||Date.parse(now)<Date.parse(o.dueAt))return conflict();
  if(action==='authorize'){
   if(consent){if(consent.revokedAt||consent.revision!==revision||consent.keyType!==destination.keyType)return conflict();return {changed:false};}
   const next:Consent={schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,recipientUid:uid,payerUid:o.payerUid,revision,keyType:destination.keyType,authorizedAt:now};
   tx.create(x.consentRef,next);writeFreelanceFinancialNotices(tx,x.c.obligation,'fixed_cancellation_adjustment_pix_authorized',now,o.payerUid===o.originalRequesterUid?'requester':'freelancer',o.sourceDigest);return {changed:true};
  }
  if(!consent||consent.revokedAt||consent.revision!==revision||consent.keyType!==destination.keyType||Date.parse(now)<Date.parse(consent.authorizedAt))return blocked();
  if(!x.access)tx.create(x.accessRef,{schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,payerUid:uid,revision,amountMinor:o.amountMinor,firstAccessAt:now});
  return {offerId:id,sourceDigest:o.sourceDigest,direction:o.direction,amountMinor:o.amountMinor,currency:'BRL',revision,keyType:destination.keyType,key:destination.key,ownershipVerified:false,bankVerified:false};
 });
}
