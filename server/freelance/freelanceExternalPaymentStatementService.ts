import {adminDb,getFirebaseAdminProjectId} from '../firebaseAdmin.js';
import {validFreelanceId,type FreelanceOffer,type FreelanceApplication} from '../../shared/freelanceLifecycle.js';
import {buildFreelancePaymentObligation,matchesFreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {buildFreelanceRemunerationBasis,matchesFreelanceRemunerationBasis} from '../../shared/freelanceRemuneration.js';
import {appendExternalPixStatement,projectExternalPixStatements,type ExternalPixEvent,type ExternalPixStatement} from '../../shared/freelanceExternalPaymentStatements.js';
import {prepareVoluntaryDisputeRestriction} from './freelanceEngagementRestrictionService.js';

function assertLocal(){
 if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
 getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
}
function contractSnapshot<T extends FreelanceOffer|FreelanceApplication>(record:T):T{
 const {startedAt,completionRequestedAt,completedAt,...rest}=record;
 return {...rest,status:'contracted'} as T;
}
function readEvents(raw:unknown,offerId:string):ExternalPixEvent[]{
 if(raw===undefined)return [];
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
 const r=raw as {schemaVersion:unknown;offerId:unknown;events:unknown};
 if(Object.keys(r).length!==3||r.schemaVersion!==1||r.offerId!==offerId||!Array.isArray(r.events)||r.events.length<1||r.events.length>3||
 !r.events.every(e=>e&&typeof e==='object'&&Object.keys(e).length===4&&typeof e.id==='string'&&typeof e.actorUid==='string'&&
 typeof e.recordedAt==='string'&&['paid','received','not_received'].includes(e.statement)))throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
 return r.events;
}
/** Service-only; the authenticated transport must supply the actor UID.
 * Participant statements record facts as asserted, not provider verification.
 * The restriction and its causal history commit together or neither commits.
 */
export async function recordFreelanceExternalPaymentStatement(uid:string,offerId:string,input:unknown){
 assertLocal();
 if(!validFreelanceId(uid)||!validFreelanceId(offerId)||!input||typeof input!=='object'||Array.isArray(input))throw Error('FREELANCE_INVALID');
 const b=input as Record<string,unknown>;
 if(Object.keys(b).length!==3||!validFreelanceId(b.eventId)||b.confirmed!==true||
 !['paid','received','not_received'].includes(String(b.statement)))throw Error('FREELANCE_INVALID');
 const ref=adminDb.doc('freelanceOffersV1/'+offerId),direct=ref.collection('directPayment');
 const statementRef=direct.doc('externalStatements');
 return adminDb.runTransaction(async tx=>{
  const [o,ob,history]=await tx.getAll(ref,direct.doc('obligation'),statementRef);
  const offer=o.data() as FreelanceOffer|undefined;
  if(!offer||offer.id!==offerId||!validFreelanceId(offer.selectedApplicantUid)||
   (uid!==offer.ownerUid&&uid!==offer.selectedApplicantUid))throw Error('FREELANCE_FORBIDDEN');
  if((b.statement==='paid'&&uid!==offer.ownerUid)||(b.statement!=='paid'&&uid!==offer.selectedApplicantUid))throw Error('FREELANCE_FORBIDDEN');
  const app=(await tx.get(ref.collection('applications').doc(offer.selectedApplicantUid))).data() as FreelanceApplication|undefined;
  if(!app||app.status!==offer.status||!['contracted','in_progress','completion_requested','completed'].includes(offer.status))
   throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
  const obligation=buildFreelancePaymentObligation(contractSnapshot(offer),contractSnapshot(app));
  if(obligation.terms.method!=='external_pix'||!matchesFreelancePaymentObligation(ob.data(),obligation))
   throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
  if(obligation.dueTrigger==='bilateral_service_completion'&&offer.status!=='completed')throw Error('FREELANCE_PAYMENT_NOT_DUE');
  if(offer.status==='completed'){
   const basis=buildFreelanceRemunerationBasis(offer,app);
   const saved=await tx.get(ref.collection('financialBasis').doc('remuneration'));
   if(!matchesFreelanceRemunerationBasis(saved.data(),basis))throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
  }
  const events=readEvents(history.data(),offerId);
  projectExternalPixStatements(obligation,events);
  const now=new Date().toISOString();
  if(obligation.dueTrigger==='bilateral_service_completion'&&
   (Date.parse(now)<Date.parse(offer.completedAt!)||events.some(e=>Date.parse(e.recordedAt)<Date.parse(offer.completedAt!))))throw Error('FREELANCE_PAYMENT_STATEMENT_CONFLICT');
  const next=appendExternalPixStatement(obligation,events,{id:b.eventId as string,actorUid:uid,statement:b.statement as ExternalPixStatement,recordedAt:now});
  if(next.changed){
   const writeRestrictions=await prepareVoluntaryDisputeRestriction(tx,obligation,events,next.events);
   tx.set(statementRef,{schemaVersion:1,offerId,events:next.events});
   writeRestrictions();
  }
  return {changed:next.changed,state:next.state,hadDisagreement:next.hadDisagreement,bankVerified:false as const,settlementEvidence:next.settlementEvidence};
 });
}
