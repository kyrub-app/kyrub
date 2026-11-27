import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication} from '../../shared/freelanceLifecycle.js';
import {buildFreelancePaymentObligation,matchesFreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {readPersonalPixForContract} from '../payments/personalPixDestinationService.js';
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
