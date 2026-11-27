import {adminDb} from '../firebaseAdmin.js';
import {readAdjustmentStatementContext} from './freelanceFixedAdjustmentStatementService.js';
import {readPersonalPixForContract,readPersonalPixSecretForContract} from '../payments/personalPixDestinationService.js';
import {writeFreelanceFinancialNotices} from './freelanceFinancialNoticeService.js';
import {validFreelanceId} from '../../shared/freelanceLifecycle.js';
const conflict=():never=>{throw Error('FREELANCE_PIX_DESTINATION_CHANGED');};
const blocked=():never=>{throw Error('FREELANCE_PIX_DISCLOSURE_UNAVAILABLE');};
type Rebind={schemaVersion:1;offerId:string;sourceDigest:string;oldRevision:number;newRevision:number;keyType:string;proposedAt:string;status:'pending'|'accepted'|'withdrawn';decidedAt?:string};
type Consent={schemaVersion:1;offerId:string;sourceDigest:string;recipientUid:string;payerUid:string;revision:number;keyType:string;authorizedAt:string;revokedAt?:string};
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;
async function context(tx:FirebaseFirestore.Transaction,uid:string,id:string){
 const financial=await readAdjustmentStatementContext(tx,uid,id),{c,o}=financial;
 // A recipient's isolated nonreceipt is not a declaration that payment was sent.
 // Any paid/received statement, review, or inconsistent financial source fails closed.
 const paymentBlocked=!!financial.queue||!['awaiting_payment','nonreceipt_reported'].includes(financial.projection.state);
 const consentRef=c.direct.doc('fixedAdjustmentPixConsent'),accessRef=c.direct.doc('fixedAdjustmentPixDisclosure');
 const replacementRef=c.direct.doc('fixedAdjustmentPixReplacement');
 const [saved,access,replacementDoc]=await tx.getAll(consentRef,accessRef,replacementRef);
 const consent=saved.data() as Consent|undefined;
 if(consent&&(
 Object.keys(consent).length!==(consent.revokedAt===undefined?8:9)||consent.schemaVersion!==1||consent.offerId!==id||consent.sourceDigest!==o.sourceDigest||consent.recipientUid!==o.recipientUid||consent.payerUid!==o.payerUid||!Number.isSafeInteger(consent.revision)||consent.revision<1||!['cpf','email','phone','random'].includes(consent.keyType)||!iso(consent.authorizedAt)||Date.parse(consent.authorizedAt)<Date.parse(o.dueAt)||(consent.revokedAt!==undefined&&(!iso(consent.revokedAt)||Date.parse(consent.revokedAt)<Date.parse(consent.authorizedAt)))))return conflict();
 const a=access.data();
 if(a&&(!consent||Object.keys(a).length!==7||a.schemaVersion!==1||a.offerId!==id||a.sourceDigest!==o.sourceDigest||a.payerUid!==o.payerUid||a.revision!==consent.revision||a.amountMinor!==o.amountMinor||!iso(a.firstAccessAt)||Date.parse(a.firstAccessAt)<Date.parse(consent.authorizedAt)||(consent.revokedAt!==undefined&&Date.parse(a.firstAccessAt)>Date.parse(consent.revokedAt))))return conflict();
 const replacement=replacementDoc.data() as Rebind|undefined;
 if(replacement){
  const r=replacement;
  if(!consent||Object.keys(r).length!==(r.status==='pending'?8:9)||r.schemaVersion!==1||r.offerId!==id||r.sourceDigest!==o.sourceDigest||!Number.isSafeInteger(r.oldRevision)||r.oldRevision<1||!Number.isSafeInteger(r.newRevision)||r.newRevision<=r.oldRevision||!['cpf','email','phone','random'].includes(r.keyType)||!iso(r.proposedAt)||Date.parse(r.proposedAt)<Date.parse(o.dueAt)||!['pending','accepted','withdrawn'].includes(r.status)||(r.status==='pending'?r.decidedAt!==undefined||consent.revision!==r.oldRevision:!iso(r.decidedAt)||Date.parse(r.decidedAt)<Date.parse(r.proposedAt)||(r.status==='accepted'?consent.revision!==r.newRevision||consent.keyType!==r.keyType||consent.authorizedAt!==r.decidedAt:consent.revision!==r.oldRevision)))return conflict();
  if(r.status==='accepted'){
   const archived=(await tx.get(c.direct.doc('fixedAdjustmentPixArchive-'+r.oldRevision))).data();
   if(!archived||archived.sourceDigest!==o.sourceDigest||archived.offerId!==id||archived.consent?.revision!==r.oldRevision||archived.replacement?.newRevision!==r.newRevision||archived.replacement?.decidedAt!==r.decidedAt)return conflict();
  }
 }
 return {c,o,consent,consentRef,accessRef,access:a,replacement,replacementRef,paymentBlocked,financialState:financial.projection.state,storeRefund:o.direction==='refund'&&!!o.requesterStoreId};
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
  if(!x.storeRefund&&!x.paymentBlocked&&(role==='recipient'||consent&&(!consent.revokedAt||x.replacement?.status==='pending'))){
   try{destination=await readPersonalPixForContract(tx,o.recipientUid);}catch(e){if(!(e instanceof Error)||e.message!=='FREELANCE_PIX_DESTINATION_REQUIRED')throw e;}
  }
  const current=!!destination&&(!consent||destination.revision===consent.revision&&destination.keyType===consent.keyType);
  const pending=x.replacement?.status==='pending',replacement=pending?{oldRevision:x.replacement!.oldRevision,newRevision:x.replacement!.newRevision,pending:true,available:!x.paymentBlocked&&!x.storeRefund&&destination?.revision===x.replacement!.newRevision}:consent&&!x.paymentBlocked&&!x.storeRefund&&destination&&destination.revision>consent.revision&&role==='recipient'&&(!x.replacement||destination.revision>x.replacement.newRevision)?{oldRevision:consent.revision,newRevision:destination.revision,pending:false,available:true}:null;
  return {offerId:id,sourceDigest:o.sourceDigest,direction:o.direction,amountMinor:o.amountMinor,role,replacement,storeRefund:x.storeRefund,consentRevision:consent?.revision??null,authorized:!!consent&&!consent.revokedAt,revoked:!!consent?.revokedAt,disclosed:!!x.access,blocked:x.paymentBlocked||x.storeRefund,financialState:x.financialState, destination:current&&!pending?destination:null,bankVerified:false};
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
   if(consent.revokedAt&&x.replacement?.status!=='pending')return {changed:false};
   if(x.replacement?.status==='pending')tx.update(x.replacementRef,{status:'withdrawn',decidedAt:now});
   if(consent.revokedAt)return {changed:true};
   tx.update(x.consentRef,{revokedAt:now});
   writeFreelanceFinancialNotices(tx,x.c.obligation,'fixed_cancellation_adjustment_pix_revoked',now,o.payerUid===o.originalRequesterUid?'requester':'freelancer',o.sourceDigest+'-'+revision);
   return {changed:true};
  }
  if(x.storeRefund||x.paymentBlocked||x.replacement?.status==='pending')return blocked();
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

/** The proposal itself explicitly grants consent to the NEW revision, effective
 * only when the payer confirms no transfer was sent. Withdrawal cancels pending consent. */
export async function changeAdjustmentPixReplacement(uid:string,id:string,action:'propose'|'accept'|'withdraw',input:{sourceDigest:unknown;expectedAmountMinor:unknown;oldRevision:unknown;newRevision:unknown;confirmed:unknown;paymentNotSent?:unknown}){
 if(!validFreelanceId(uid)||!validFreelanceId(id)||input.confirmed!==true||typeof input.sourceDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.sourceDigest)||!Number.isSafeInteger(input.expectedAmountMinor)||Number(input.expectedAmountMinor)<1||!Number.isSafeInteger(input.oldRevision)||Number(input.oldRevision)<1||!Number.isSafeInteger(input.newRevision)||Number(input.newRevision)<=Number(input.oldRevision)||(action==='accept'&&input.paymentNotSent!==true))throw Error('FREELANCE_INVALID');
 const oldRevision=Number(input.oldRevision),newRevision=Number(input.newRevision);
 return adminDb.runTransaction(async tx=>{
  const x=await context(tx,uid,id),{o,consent,replacement:r}=x;
  if(uid!==(action==='accept'?o.payerUid:o.recipientUid))throw Error('FREELANCE_FORBIDDEN');
  if(input.sourceDigest!==o.sourceDigest||input.expectedAmountMinor!==o.amountMinor||!consent)return conflict();
  const now=new Date().toISOString();
  const same=r&&r.oldRevision===oldRevision&&r.newRevision===newRevision;
  if(action==='withdraw'){
   if(!same)return conflict();
   if(r.status==='withdrawn')return {changed:false};
   if(r.status!=='pending'||Date.parse(now)<Date.parse(r.proposedAt))return conflict();
   tx.update(x.replacementRef,{status:'withdrawn',decidedAt:now});return {changed:true};
  }
  if(action==='accept'&&same&&r.status==='accepted')return {changed:false};
  if(x.storeRefund||x.paymentBlocked)return blocked();
  if(consent.revision!==oldRevision)return conflict();
  await eligible(tx,o);
  const destination=await readPersonalPixForContract(tx,o.recipientUid);
  if(destination.revision!==newRevision||Date.parse(now)<Date.parse(consent.revokedAt??consent.authorizedAt))return conflict();
  if(action==='propose'){
   if(same&&r.status==='pending'&&r.keyType===destination.keyType)return {changed:false};
   if(r?.status==='pending'||r&&newRevision<=r.newRevision)return conflict();
   const proposal:Rebind={schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,oldRevision,newRevision,keyType:destination.keyType,proposedAt:now,status:'pending'};
   if(r){const previous=x.c.direct.doc('fixedAdjustmentPixProposal-'+r.newRevision);if((await tx.get(previous)).exists)return conflict();tx.create(previous,r);}
   tx.set(x.replacementRef,proposal);
   writeFreelanceFinancialNotices(tx,x.c.obligation,'fixed_cancellation_adjustment_pix_proposed',now,o.payerUid===o.originalRequesterUid?'requester':'freelancer',o.sourceDigest+'-'+newRevision);
   return {changed:true};
  }
  if(!same||r.status!=='pending'||r.keyType!==destination.keyType||Date.parse(now)<Date.parse(r.proposedAt))return conflict();
  const archive=x.c.direct.doc('fixedAdjustmentPixArchive-'+oldRevision);
  if((await tx.get(archive)).exists)return conflict();
  const accepted:Rebind={...r,status:'accepted',decidedAt:now};
  tx.create(archive,{schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,consent,disclosure:x.access??null,replacement:accepted});
  tx.set(x.replacementRef,accepted);
  tx.set(x.consentRef,{schemaVersion:1,offerId:id,sourceDigest:o.sourceDigest,recipientUid:o.recipientUid,payerUid:o.payerUid,revision:newRevision,keyType:destination.keyType,authorizedAt:now});
  if(x.access)tx.delete(x.accessRef);
  writeFreelanceFinancialNotices(tx,x.c.obligation,'fixed_cancellation_adjustment_pix_replaced',now,o.recipientUid===o.originalRequesterUid?'requester':'freelancer',o.sourceDigest+'-'+newRevision);
  return {changed:true};
 });
}
