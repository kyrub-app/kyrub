import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication} from '../../shared/freelanceLifecycle.js';
import {buildFreelancePaymentObligation,matchesFreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {assertFinancialCaseRestrictions} from './freelanceEngagementRestrictionService.js';
import {readFinancialContext,checkedReview} from './freelanceExternalPaymentStatementService.js';
import {readPersonalPixForContract,readPersonalPixSecretForContract} from '../payments/personalPixDestinationService.js';
import type {PersonalPixKeyType} from '../../shared/personalPixDestination.js';

type Binding={schemaVersion:1;offerId:string;beneficiaryUid:string;destinationRevision:number;keyType:PersonalPixKeyType;boundAt:string;ownershipVerified:false};
function assertLocal(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
function matches(raw:unknown,offerId:string,uid:string,contractedAt:string):raw is Binding{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const b=raw as Binding;
 return Object.keys(b).length===7&&b.schemaVersion===1&&b.offerId===offerId&&b.beneficiaryUid===uid&&
 Number.isSafeInteger(b.destinationRevision)&&b.destinationRevision>0&&['cpf','email','phone','random'].includes(b.keyType)&&
 Number.isFinite(Date.parse(b.boundAt))&&Date.parse(b.boundAt)>=Date.parse(contractedAt)&&b.ownershipVerified===false;
}
/** Explicit confirmation by beneficiary, while contract is not yet started.
 * Only a revision pointer is stored. Replacement/revocation blocks use instead
 * of silently changing the recipient. Future rebind needs a separately agreed flow.
 */
export async function bindFreelancePixDestination(uid:string,offerId:string,input:unknown){
 assertLocal();
 if(!validFreelanceId(uid)||!validFreelanceId(offerId)||!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const data=input as Record<string,unknown>;
 if(Object.keys(data).length!==2||data.confirmed!==true||!Number.isSafeInteger(data.expectedRevision)||Number(data.expectedRevision)<1)throw Error('FREELANCE_INVALID');
 const ref=adminDb.doc('freelanceOffersV1/'+offerId),bindingRef=ref.collection('directPayment').doc('receivingDestination');
 return adminDb.runTransaction(async tx=>{
  const [o,a,ob,existing,identity]=await tx.getAll(ref,ref.collection('applications').doc(uid),ref.collection('directPayment').doc('obligation'),bindingRef,adminDb.doc('identity_verifications/'+uid));
  const offer=o.data() as FreelanceOffer|undefined,app=a.data() as FreelanceApplication|undefined;
  if(!offer||!app||offer.id!==offerId||offer.selectedApplicantUid!==uid||app.applicantUid!==uid)throw Error('FREELANCE_FORBIDDEN');
  const obligation=buildFreelancePaymentObligation(offer,app);
  if(obligation.terms.method!=='external_pix'||!matchesFreelancePaymentObligation(ob.data(),obligation))throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
  const roles=identity.get('approvedProfiles');
  if(identity.get('status')!=='approved'||!Array.isArray(roles)||!roles.includes('freelancer'))throw Error('IDENTITY_VERIFICATION_REQUIRED');
  const destination=await readPersonalPixForContract(tx,uid);
  if(destination.revision!==data.expectedRevision)throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
  if(existing.exists){
   const saved=existing.data();
   if(!matches(saved,offerId,uid,obligation.contractedAt)||saved.destinationRevision!==destination.revision||saved.keyType!==destination.keyType)throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
   return {created:false,revision:destination.revision,ownershipVerified:false as const};
  }
  const boundAt=new Date().toISOString();
  if(Date.parse(boundAt)<Date.parse(obligation.contractedAt))throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
  const binding:Binding={schemaVersion:1,offerId,beneficiaryUid:uid,destinationRevision:destination.revision,keyType:destination.keyType,boundAt,ownershipVerified:false};
  tx.create(bindingRef,binding);
  return {created:true,revision:destination.revision,ownershipVerified:false as const};
 });
}

type Sharing={schemaVersion:1;offerId:string;requesterUid:string;beneficiaryUid:string;destinationRevision:number;authorizedAt:string};
function matchesSharing(raw:unknown,obligation:ReturnType<typeof buildFreelancePaymentObligation>,binding:Binding):raw is Sharing{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
 const s=raw as Sharing;
 return Object.keys(s).length===6&&s.schemaVersion===1&&s.offerId===obligation.offerId&&s.requesterUid===obligation.requesterUid&&
 s.beneficiaryUid===obligation.beneficiaryUid&&s.destinationRevision===binding.destinationRevision&&
 Number.isFinite(Date.parse(s.authorizedAt))&&Date.parse(s.authorizedAt)>=Date.parse(binding.boundAt);
}
const blocked=()=>{throw Error('FREELANCE_PIX_DISCLOSURE_UNAVAILABLE');};
function explicitRevision(input:unknown){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==2||b.confirmed!==true||!Number.isSafeInteger(b.expectedRevision)||Number(b.expectedRevision)<1)throw Error('FREELANCE_INVALID');
 return Number(b.expectedRevision);
}
async function readDisclosureContext(tx:FirebaseFirestore.Transaction,uid:string,id:string){
 const direct=adminDb.doc('freelanceOffersV1/'+id).collection('directPayment');
 const reviewDoc=await tx.get(adminDb.doc('freelanceFinancialReviewsV1/'+id));
 const context=await readFinancialContext(tx,uid,id,true);
 const {obligation,events}=context;
 const review=checkedReview(reviewDoc.data(),obligation);
 const [bindingDoc,sharingDoc]=await tx.getAll(direct.doc('receivingDestination'),direct.doc('pixSharing'));
 if(review||events.some(e=>e.statement==='paid'||e.statement==='received'))return blocked();
 const binding=bindingDoc.data();
 if(!bindingDoc.exists)throw Error('FREELANCE_PIX_DESTINATION_REQUIRED');
 if(!matches(binding,id,obligation.beneficiaryUid,obligation.contractedAt))throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
 const sharing=sharingDoc.data();
 if(sharingDoc.exists&&!matchesSharing(sharing,obligation,binding))throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
 return {...context,binding,sharing:sharing as Sharing|undefined,direct};
}
/** Separate from binding: explicit permission to share this revision with this
 * specific contractual requester. A new destination never silently inherits it. */
export async function authorizeFreelancePixSharing(uid:string,id:string,input:unknown){
 assertLocal();if(!validFreelanceId(uid)||!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 const revision=explicitRevision(input);
 return adminDb.runTransaction(async tx=>{
  const c=await readDisclosureContext(tx,uid,id);
  if(uid!==c.obligation.beneficiaryUid)throw Error('FREELANCE_FORBIDDEN');
  const identity=await tx.get(adminDb.doc('identity_verifications/'+uid)),roles=identity.get('approvedProfiles');
  if(identity.get('status')!=='approved'||!Array.isArray(roles)||!roles.includes('freelancer'))throw Error('IDENTITY_VERIFICATION_REQUIRED');
  const destination=await readPersonalPixForContract(tx,uid);
  if(revision!==c.binding.destinationRevision||revision!==destination.revision||c.binding.keyType!==destination.keyType)throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
  if(c.sharing)return {created:false,revision};
  const authorizedAt=new Date().toISOString();
  if(Date.parse(authorizedAt)<Date.parse(c.binding.boundAt))throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
  const sharing:Sharing={schemaVersion:1,offerId:id,requesterUid:c.obligation.requesterUid,beneficiaryUid:uid,destinationRevision:revision,authorizedAt};
  tx.create(c.direct.doc('pixSharing'),sharing);
  return {created:true,revision};
 });
}
/** Metadata for either participant; never reveal a raw key in ordinary reads. */
export async function readFreelancePixSharing(uid:string,id:string){
 assertLocal();if(!validFreelanceId(uid)||!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 return adminDb.runTransaction(async tx=>{
  const c=await readDisclosureContext(tx,uid,id);
  const destination=await readPersonalPixForContract(tx,c.obligation.beneficiaryUid);
  if(c.binding.destinationRevision!==destination.revision||c.binding.keyType!==destination.keyType)throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
  return {revision:destination.revision,keyType:destination.keyType,maskedKey:destination.maskedKey,sharingAuthorized:!!c.sharing,due:c.due,ownershipVerified:false as const};
 },{readOnly:true});
}
/** Raw key is returned only to the authenticated contractual payer, on an
 * explicit recent-login request, due and not already declared paid/received.
 * First access is recorded without storing a second copy of the key. */
export async function revealFreelancePixDestination(uid:string,id:string,input:unknown){
 assertLocal();if(!validFreelanceId(uid)||!validFreelanceId(id))throw Error('FREELANCE_INVALID');
 const revision=explicitRevision(input);
 return adminDb.runTransaction(async tx=>{
  const c=await readDisclosureContext(tx,uid,id);
  if(uid!==c.obligation.requesterUid)throw Error('FREELANCE_FORBIDDEN');
  if(!c.due)throw Error('FREELANCE_PAYMENT_NOT_DUE');
  if(!c.sharing)return blocked();
  const [payer,beneficiary,access]=await tx.getAll(adminDb.doc('identity_verifications/'+uid),adminDb.doc('identity_verifications/'+c.obligation.beneficiaryUid),c.direct.doc('pixDisclosure'));
  for(const [identity,role] of [[payer,'requester'],[beneficiary,'freelancer']] as const){
   const roles=identity.get('approvedProfiles');
   if(identity.get('status')!=='approved'||!Array.isArray(roles)||!roles.includes(role))throw Error('IDENTITY_VERIFICATION_REQUIRED');
  }
  const destination=await readPersonalPixSecretForContract(tx,c.obligation.beneficiaryUid);
  if(revision!==c.binding.destinationRevision||revision!==destination.revision||c.binding.keyType!==destination.keyType)throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
  const firstAccessAt=new Date().toISOString();
  if(Date.parse(firstAccessAt)<Date.parse(c.sharing.authorizedAt))return blocked();
  if(access.exists){
   const a=access.data()!;
   if(Object.keys(a).length!==5||a.schemaVersion!==1||a.offerId!==id||a.requesterUid!==uid||a.destinationRevision!==revision||
    !Number.isFinite(Date.parse(a.firstAccessAt))||Date.parse(a.firstAccessAt)<Date.parse(c.sharing.authorizedAt))return blocked();
  }else tx.create(c.direct.doc('pixDisclosure'),{schemaVersion:1,offerId:id,requesterUid:uid,destinationRevision:revision,firstAccessAt});
  return {key:destination.key,keyType:destination.keyType,revision,amountMinor:c.obligation.terms.amountMinor,currency:'BRL' as const,ownershipVerified:false as const,bankVerified:false as const};
 });
}

/** Local-only operational gate. Participant declarations never become bank
 * verification. A paid advance uses its historical authorized destination;
 * revoking a key after receipt must not prevent performance of paid work.
 * A completion contract needs an active authorized revision before starting.
 * Only this contract's restriction is relevant; do not block existing work
 * because another engagement is disputed.
 */
export async function assertDirectPixStart(tx:FirebaseFirestore.Transaction,offer:FreelanceOffer,application:FreelanceApplication){
 assertLocal();
 if(process.env.KYRUB_FREELANCE_LOCAL_HOMOLOGATION!=='true'||process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true'||
 !['127.0.0.1:9099','localhost:9099'].includes(process.env.FIREBASE_AUTH_EMULATOR_HOST??'')||
 offer.paymentTerms?.method!=='external_pix'||application.paymentTerms?.method!=='external_pix')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 if(!['contracted','in_progress'].includes(offer.status)||!validFreelanceId(offer.selectedApplicantUid))throw Error('FREELANCE_CONFLICT');
 const id=offer.id,worker=offer.selectedApplicantUid;
 const direct=adminDb.doc('freelanceOffersV1/'+id).collection('directPayment');
 const {obligation,projection}=await readFinancialContext(tx,worker,id,true);
 // An already committed start may be replayed after a destination changes.
 // The lifecycle still checks matching pair, timestamps and actor.
 if(offer.status==='in_progress')return;
 const [bindingDoc,sharingDoc,reviewDoc]=await tx.getAll(direct.doc('receivingDestination'),direct.doc('pixSharing'),adminDb.doc('freelanceFinancialReviewsV1/'+id));
 const binding=bindingDoc.data();
 if(!bindingDoc.exists)throw Error('FREELANCE_PIX_DESTINATION_REQUIRED');
 if(!matches(binding,id,worker,obligation.contractedAt))throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
 if(!sharingDoc.exists)throw Error('FREELANCE_PIX_SHARING_REQUIRED');
 if(!matchesSharing(sharingDoc.data(),obligation,binding))throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
 const review=checkedReview(reviewDoc.data(),obligation);
 if(obligation.terms.timing==='advance'){
  if(projection.state!=='bilaterally_reported_received'||review?.status==='pending')throw Error('FREELANCE_ADVANCE_RECEIPT_REQUIRED');
 }else{
  if(review||projection.state!=='awaiting_payment')throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
  const destination=await readPersonalPixForContract(tx,worker);
  if(binding.destinationRevision!==destination.revision||binding.keyType!==destination.keyType)throw Error('FREELANCE_PIX_DESTINATION_CHANGED');
 }
 await assertFinancialCaseRestrictions(tx,obligation,false);
}
