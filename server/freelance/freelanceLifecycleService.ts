import {readFreelanceCounterproposal,sameFreelanceCounterproposal,negotiatedFreelanceTerms} from '../../shared/freelanceCounterproposal.js';
import {sameFreelanceWorkTerms,assertFreelanceWorkExecutionReady} from '../../shared/freelanceWorkTerms.js';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb,getFirebaseAdminProjectId } from '../firebaseAdmin.js';
import {buildFreelancePaymentObligation,matchesFreelancePaymentObligation} from '../../shared/freelancePaymentObligation.js';
import {assertFreelanceEngagementAllowed} from './freelanceEngagementRestrictionService.js';
import {assertDirectPixStart} from './freelancePixDestinationService.js';
import {assertFreelanceFundingForStart} from './freelanceFundingService.js';
import {buildFreelanceRemunerationBasis,matchesFreelanceRemunerationBasis} from '../../shared/freelanceRemuneration.js';
import { sameFreelancePaymentTerms,createFreelanceOffer, createFreelanceApplication, validFreelanceId, selectFreelanceApplicant, confirmFreelanceSelection, releaseFreelanceSelection, withdrawFreelanceApplication, cancelOpenFreelanceOffer, advanceFreelanceExecution, openFreelanceOccurrence, recordFreelanceOccurrenceResponse, type FreelanceOccurrence, type FreelanceExecutionAction, type FreelanceSelectionResult, type FreelanceOffer, type FreelanceApplication } from '../../shared/freelanceLifecycle.js';

const offers = 'freelanceOffersV1';
const eligibility = (uid: string) => adminDb.doc('identity_verifications/' + uid);
const assertApproved = (data: Record<string, unknown> | undefined, profile: 'requester' | 'freelancer') => {
  if (data?.status !== 'approved' || !Array.isArray(data.approvedProfiles) || !data.approvedProfiles.includes(profile)) {
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }
};

/** Transport always supplies acceptance, including undefined for legacy.
 * Internal fixture callers retain their existing service contract. */
function assertAcceptedPaymentTerms(offer:FreelanceOffer,acceptance?:{expected:unknown;expectedWorkTerms?:unknown}){
 assertFreelanceWorkExecutionReady(offer.workTerms);
 if(!sameFreelanceWorkTerms(offer.workTerms,acceptance?.expectedWorkTerms,offer.paymentMinor))throw Error('FREELANCE_CONFLICT');
 if(!acceptance)return;
 if(offer.paymentTerms!==undefined&&(!['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')||
 process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||
 process.env.KYRUB_PERSONAL_FINANCE_LOCAL_HOMOLOGATION!=='true'||getFirebaseAdminProjectId()!=='kyrub-security-test'||offer.paymentTerms.method!=='external_pix'))throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
 if(!sameFreelancePaymentTerms(offer.paymentTerms,acceptance.expected,offer.paymentMinor))throw Error('FREELANCE_CONFLICT');
}
/** Service-only candidate: no client writes and no migration of legacy records. */
export async function publishFreelanceOffer(actorUid: string, offerId: string, input: unknown): Promise<{offer:FreelanceOffer;created:boolean}> {
  const proposed = createFreelanceOffer(offerId, actorUid, input, new Date().toISOString());
  assertFreelanceWorkExecutionReady(proposed.workTerms);
  if(proposed.workTerms&&!proposed.paymentTerms)throw Error('FREELANCE_INVALID');
  if(proposed.paymentTerms!==undefined&&(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||process.env.GOOGLE_APPLICATION_CREDENTIALS||!['127.0.0.1:8088','localhost:8088'].includes(process.env.FIRESTORE_EMULATOR_HOST??'')||getFirebaseAdminProjectId()!=='kyrub-security-test'))throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
  const ref = adminDb.doc(offers + '/' + offerId);
  return adminDb.runTransaction(async tx => {
    const [identity, existing] = await tx.getAll(eligibility(actorUid), ref);
    assertApproved(identity.data(), 'requester');
    if (existing.exists) {
      const saved = existing.data() as FreelanceOffer;
      if (saved.id !== proposed.id || saved.ownerUid !== actorUid || saved.status !== 'open' ||
          saved.title !== proposed.title || saved.description !== proposed.description ||
          saved.requirements !== proposed.requirements || saved.paymentMinor !== proposed.paymentMinor ||
          !sameFreelancePaymentTerms(saved.paymentTerms,proposed.paymentTerms,proposed.paymentMinor)||!sameFreelanceWorkTerms(saved.workTerms,proposed.workTerms,proposed.paymentMinor)) throw new Error('FREELANCE_CONFLICT');
      return {offer:saved,created:false};
    }
    await assertFreelanceEngagementAllowed(tx,actorUid);
    tx.create(ref, proposed);
    return {offer:proposed,created:true};
  });
}
export async function applyToFreelanceOffer(actorUid: string, offerId: string, acceptance?:{expected:unknown;expectedWorkTerms?:unknown;counterproposal?:unknown}): Promise<{application:FreelanceApplication;created:boolean}> {
  if (!validFreelanceId(actorUid) || !validFreelanceId(offerId)) throw new Error('FREELANCE_INVALID');
  const offerRef = adminDb.doc(offers + '/' + offerId);
  const applicationRef = offerRef.collection('applications').doc(actorUid);
  return adminDb.runTransaction(async tx => {
    const [identity, offerSnap, applicationSnap] = await tx.getAll(eligibility(actorUid),offerRef,applicationRef);
    assertApproved(identity.data(),'freelancer');
    const offer = offerSnap.data() as FreelanceOffer | undefined;
    if (!offerSnap.exists || !offer || offer.id !== offerId) throw new Error('FREELANCE_FORBIDDEN');
    assertAcceptedPaymentTerms(offer,acceptance);
    const proposal=readFreelanceCounterproposal(acceptance?.counterproposal,offer);
    const proposed = {...createFreelanceApplication(offer,actorUid,new Date().toISOString()),...(proposal?{counterproposal:proposal}:{})};
    if (applicationSnap.exists) {
      const saved = applicationSnap.data() as FreelanceApplication;
      if (saved.offerId !== offerId || saved.applicantUid !== actorUid || saved.ownerUid !== offer.ownerUid || saved.status !== 'pending' ||
          !sameFreelancePaymentTerms(saved.paymentTerms,proposed.paymentTerms,offer.paymentMinor)||!sameFreelanceWorkTerms(saved.workTerms,proposed.workTerms,offer.paymentMinor)||!sameFreelanceCounterproposal(saved.counterproposal,proposal,offer)) throw new Error('FREELANCE_CONFLICT');
      return {application:saved,created:false};
    }
    await assertFreelanceEngagementAllowed(tx,actorUid,offer.ownerUid);
    tx.create(applicationRef,proposed);
    return {application:proposed,created:true};
  });
}

/** Both actors are revalidated in the same transaction as the selection. */
export async function selectFreelanceApplication(actorUid: string, offerId: string, applicantUid: string,expectedCounterproposal?:unknown): Promise<FreelanceSelectionResult> {
  if (![actorUid,offerId,applicantUid].every(validFreelanceId) || actorUid === applicantUid) throw new Error('FREELANCE_INVALID');
  const offerRef = adminDb.doc(offers + '/' + offerId);
  const applicationRef = offerRef.collection('applications').doc(applicantUid);
  return adminDb.runTransaction(async tx => {
    const [ownerIdentity,workerIdentity,offerSnap,applicationSnap] = await tx.getAll(eligibility(actorUid),eligibility(applicantUid),offerRef,applicationRef);
    const offer = offerSnap.data() as FreelanceOffer | undefined;
    const application = applicationSnap.data() as FreelanceApplication | undefined;
    if (!offer || !application || offer.id !== offerId || offer.ownerUid !== actorUid || application.applicantUid !== applicantUid) throw new Error('FREELANCE_FORBIDDEN');
    assertApproved(ownerIdentity.data(),'requester');
    assertApproved(workerIdentity.data(),'freelancer');
    const proposal=readFreelanceCounterproposal(application.counterproposal,offer);
    if(!sameFreelanceCounterproposal(proposal,expectedCounterproposal,offer))throw Error('FREELANCE_CONFLICT');
    const result = selectFreelanceApplicant(offer,application,actorUid,new Date().toISOString());
    if(!result.changed&&!sameFreelanceCounterproposal(offer.selectedCounterproposal,proposal,offer))throw Error('FREELANCE_CONFLICT');
    if(proposal)result.offer={...result.offer,selectedCounterproposal:proposal};
    if(result.changed)await assertFreelanceEngagementAllowed(tx,actorUid,applicantUid);
    if (result.changed) {
      tx.update(offerRef,{status:result.offer.status,selectedApplicantUid:result.offer.selectedApplicantUid!,selectedAt:result.offer.selectedAt!,...(proposal?{selectedCounterproposal:proposal}:{})});
      tx.update(applicationRef,{status:result.application.status,selectedAt:result.application.selectedAt!});
    }
    return result;
  });
}
/** The selected worker must explicitly confirm; the owner cannot confirm for them. */
export async function confirmFreelanceContract(actorUid: string, offerId: string, confirmed: unknown, acceptance?:{expected:unknown;expectedWorkTerms?:unknown}): Promise<FreelanceSelectionResult> {
  if (!validFreelanceId(actorUid) || !validFreelanceId(offerId) || confirmed !== true) throw new Error('FREELANCE_INVALID');
  const offerRef = adminDb.doc(offers + '/' + offerId);
  const applicationRef = offerRef.collection('applications').doc(actorUid);
  return adminDb.runTransaction(async tx => {
    const [workerIdentity,offerSnap,applicationSnap] = await tx.getAll(eligibility(actorUid),offerRef,applicationRef);
    const offer = offerSnap.data() as FreelanceOffer | undefined;
    const application = applicationSnap.data() as FreelanceApplication | undefined;
    if (!offer || !application || offer.id !== offerId || !validFreelanceId(offer.ownerUid) ||
        offer.selectedApplicantUid !== actorUid || application.applicantUid !== actorUid) throw new Error('FREELANCE_FORBIDDEN');
    const ownerIdentity = await tx.get(eligibility(offer.ownerUid));
    assertApproved(ownerIdentity.data(),'requester');
    assertApproved(workerIdentity.data(),'freelancer');
    const original=offer.originalOfferTerms??offer;
    const proposal=readFreelanceCounterproposal(application.counterproposal,original);
    if(!sameFreelanceCounterproposal(offer.selectedCounterproposal,proposal,original)||(!proposal&&offer.originalOfferTerms))throw Error('FREELANCE_CONFLICT');
    const agreed=negotiatedFreelanceTerms(original,proposal);
    if(offer.status==='contracted'&&(!sameFreelancePaymentTerms(offer.paymentTerms,agreed.paymentTerms,agreed.paymentMinor)||!sameFreelanceWorkTerms(offer.workTerms,agreed.workTerms,agreed.paymentMinor)||offer.paymentMinor!==agreed.paymentMinor))throw Error('FREELANCE_CONFLICT');
    assertAcceptedPaymentTerms({...offer,...agreed},acceptance);
    const result = confirmFreelanceSelection(offer,application,actorUid,confirmed,new Date().toISOString());
    if(proposal&&result.changed){
      result.offer={...result.offer,...agreed,originalOfferTerms:negotiatedFreelanceTerms(offer,undefined)};
      result.application={...result.application,paymentTerms:agreed.paymentTerms!,workTerms:agreed.workTerms!};
    }
    if(result.changed)await assertFreelanceEngagementAllowed(tx,offer.ownerUid,actorUid);
    if(result.offer.paymentTerms!==undefined){
      // No new financial obligations outside the disposable local candidate.
      if(process.env.VERCEL||process.env.VERCEL_ENV||process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
         process.env.GOOGLE_APPLICATION_CREDENTIALS||
         !/^(127\.0\.0\.1|localhost):8088$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')||
         getFirebaseAdminProjectId()!=='kyrub-security-test')throw Error('FREELANCE_DIRECT_PAYMENT_NOT_ENABLED');
      const obligation=buildFreelancePaymentObligation(result.offer,result.application);
      const obligationRef=offerRef.collection('directPayment').doc('obligation');
      const existing=await tx.get(obligationRef);
      if(result.changed){
        if(existing.exists)throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
        tx.create(obligationRef,obligation);
      }else if(!matchesFreelancePaymentObligation(existing.data(),obligation))throw Error('FREELANCE_PAYMENT_OBLIGATION_CONFLICT');
    }
    if (result.changed) {
      tx.update(offerRef,{status:result.offer.status,contractedAt:result.offer.contractedAt!,...(proposal?{paymentMinor:result.offer.paymentMinor,paymentTerms:result.offer.paymentTerms!,workTerms:result.offer.workTerms!,originalOfferTerms:result.offer.originalOfferTerms!}:{})});
      tx.update(applicationRef,{status:result.application.status,contractedAt:result.application.contractedAt!,...(proposal?{paymentTerms:result.application.paymentTerms!,workTerms:result.application.workTerms!}:{})});
    }
    return result;
  });
}

/** Release a reservation before contracting; no cancellation of an executed contract here. */
export async function releaseFreelanceReservation(actorUid:string, offerId:string, applicantUid:string, confirmed:unknown):Promise<FreelanceSelectionResult> {
  if (![actorUid,offerId,applicantUid].every(validFreelanceId) || confirmed !== true) throw new Error('FREELANCE_INVALID');
  const offerRef=adminDb.doc(offers+'/'+offerId);
  const applicationRef=offerRef.collection('applications').doc(applicantUid);
  return adminDb.runTransaction(async tx=>{
    const [o,a]=await tx.getAll(offerRef,applicationRef);
    const offer=o.data() as FreelanceOffer|undefined;
    const application=a.data() as FreelanceApplication|undefined;
    if(!offer || !application || offer.id!==offerId || application.applicantUid!==applicantUid) throw new Error('FREELANCE_FORBIDDEN');
    const result=releaseFreelanceSelection(offer,application,actorUid,confirmed,new Date().toISOString());
    if(result.changed){
      tx.update(offerRef,{status:'open',selectedApplicantUid:FieldValue.delete(),selectedAt:FieldValue.delete(),selectedCounterproposal:FieldValue.delete()});
      tx.update(applicationRef,{status:'released',releasedAt:result.application.releasedAt!,releasedBy:actorUid});
    }
    return result;
  });
}
export async function withdrawPendingFreelanceApplication(actorUid:string,offerId:string,confirmed:unknown):Promise<FreelanceSelectionResult>{
  if(!validFreelanceId(actorUid)||!validFreelanceId(offerId)||confirmed!==true)throw new Error('FREELANCE_INVALID');
  const offerRef=adminDb.doc(offers+'/'+offerId);
  const applicationRef=offerRef.collection('applications').doc(actorUid);
  return adminDb.runTransaction(async tx=>{
    const [o,a]=await tx.getAll(offerRef,applicationRef);
    const offer=o.data() as FreelanceOffer|undefined;
    const application=a.data() as FreelanceApplication|undefined;
    if(!offer||!application||offer.id!==offerId||application.applicantUid!==actorUid)throw new Error('FREELANCE_FORBIDDEN');
    const result=withdrawFreelanceApplication(offer,application,actorUid,confirmed,new Date().toISOString());
    if(result.changed)tx.update(applicationRef,{status:'withdrawn',withdrawnAt:result.application.withdrawnAt!});
    return result;
  });
}
export async function cancelUncontractedFreelanceOffer(actorUid:string,offerId:string,confirmed:unknown):Promise<FreelanceOffer>{
  if(!validFreelanceId(actorUid)||!validFreelanceId(offerId)||confirmed!==true)throw new Error('FREELANCE_INVALID');
  const ref=adminDb.doc(offers+'/'+offerId);
  return adminDb.runTransaction(async tx=>{
    const snap=await tx.get(ref);
    const offer=snap.data() as FreelanceOffer|undefined;
    if(!offer||offer.id!==offerId)throw new Error('FREELANCE_FORBIDDEN');
    const result=cancelOpenFreelanceOffer(offer,actorUid,confirmed,new Date().toISOString());
    if(result!==offer)tx.update(ref,{status:'cancelled',cancelledAt:result.cancelledAt!});
    return result;
  });
}
/** Operational completion is not payment evidence. All reads precede state changes. */
export async function recordFreelanceExecution(actorUid:string,offerId:string,action:FreelanceExecutionAction,confirmed:unknown):Promise<FreelanceSelectionResult>{
  if(!validFreelanceId(actorUid)||!validFreelanceId(offerId)||confirmed!==true)throw new Error('FREELANCE_INVALID');
  const offerRef=adminDb.doc(offers+'/'+offerId);
  return adminDb.runTransaction(async tx=>{
    const offer=(await tx.get(offerRef)).data() as FreelanceOffer|undefined;
    if(!offer||offer.id!==offerId||!validFreelanceId(offer.ownerUid)||!validFreelanceId(offer.selectedApplicantUid)||
       (actorUid!==offer.ownerUid&&actorUid!==offer.selectedApplicantUid))throw new Error('FREELANCE_FORBIDDEN');
    const applicationRef=offerRef.collection('applications').doc(offer.selectedApplicantUid);
    const snap=await tx.get(applicationRef);
    const application=snap.data() as FreelanceApplication|undefined;
    if(!application||application.applicantUid!==offer.selectedApplicantUid)throw new Error('FREELANCE_FORBIDDEN');
    // Starting new work requires both profiles. Completion of already executed work
    // remains recordable by the participants even if documentary approval changes.
    if(action==='start'){
      const [owner,worker]=await tx.getAll(eligibility(offer.ownerUid),eligibility(offer.selectedApplicantUid));
      assertApproved(owner.data(),'requester');
      assertApproved(worker.data(),'freelancer');
      if(offer.paymentTerms!==undefined||application.paymentTerms!==undefined){
        if(actorUid!==offer.selectedApplicantUid)throw Error('FREELANCE_FORBIDDEN');
        await assertDirectPixStart(tx,offer,application);
      }else await assertFreelanceFundingForStart(tx,offer,application);
    }
    const result=advanceFreelanceExecution(offer,application,actorUid,action,confirmed,new Date().toISOString());
    if(action==='confirm_completion'){
      const basis=buildFreelanceRemunerationBasis(result.offer,result.application);
      const basisRef=offerRef.collection('financialBasis').doc('remuneration');
      const saved=await tx.get(basisRef);
      if(result.changed){
        if(saved.exists)throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
        tx.create(basisRef,basis);
      }else if(!matchesFreelanceRemunerationBasis(saved.data(),basis))throw Error('FREELANCE_FINANCIAL_BASIS_CONFLICT');
    }
    if(result.changed){
      const at=action==='start'?'startedAt':action==='request_completion'?'completionRequestedAt':'completedAt';
      tx.update(offerRef,{status:result.offer.status,[at]:result.offer[at]!});
      tx.update(applicationRef,{status:result.application.status,[at]:result.application[at]!});
    }
    return result;
  });
}

/** A participant can report an occurrence; neither can adjudicate or settle it. */
export async function reportFreelanceOccurrence(actorUid:string, offerId:string, kind:unknown, confirmed:unknown, occurrenceId:string):Promise<FreelanceOccurrence>{
  if(!validFreelanceId(actorUid)||!validFreelanceId(offerId)||!validFreelanceId(occurrenceId)||confirmed!==true)throw new Error('FREELANCE_INVALID');
  const offerRef=adminDb.doc(offers+'/'+offerId);
  const occurrenceRef=offerRef.collection('occurrences').doc(occurrenceId);
  return adminDb.runTransaction(async tx=>{
    const [o,review]=await tx.getAll(offerRef,occurrenceRef);
    const offer=o.data() as FreelanceOffer|undefined;
    if(!offer||offer.id!==offerId||!validFreelanceId(offer.selectedApplicantUid)||
      (actorUid!==offer.ownerUid&&actorUid!==offer.selectedApplicantUid))throw new Error('FREELANCE_FORBIDDEN');
    const applicationRef=offerRef.collection('applications').doc(offer.selectedApplicantUid);
    const application=(await tx.get(applicationRef)).data() as FreelanceApplication|undefined;
    if(!application||application.offerId!==offerId||application.ownerUid!==offer.ownerUid||
      application.applicantUid!==offer.selectedApplicantUid)throw new Error('FREELANCE_CONFLICT');
    if(review.exists){
      const saved=review.data() as FreelanceOccurrence;
      if(saved.id===occurrenceId&&saved.offerId===offerId&&saved.ownerUid===offer.ownerUid&&
        saved.applicantUid===application.applicantUid&&saved.openedBy===actorUid&&saved.kind===kind&&saved.status==='awaiting_review'&&
        offer.status==='under_review'&&application.status==='under_review'&&offer.occurrenceId===saved.id&&application.occurrenceId===saved.id)return saved;
      throw new Error('FREELANCE_CONFLICT');
    }
    const result=openFreelanceOccurrence(offer,application,actorUid,kind,confirmed,new Date().toISOString(),occurrenceId);
    tx.create(occurrenceRef,result);
    tx.update(offerRef,{status:'under_review',occurrenceId:result.id});
    tx.update(applicationRef,{status:'under_review',occurrenceId:result.id});
    return result;
  });
}
export async function respondToFreelanceOccurrence(actorUid:string,offerId:string,position:unknown,confirmed:unknown,occurrenceId:string):Promise<FreelanceOccurrence>{
  if(!validFreelanceId(actorUid)||!validFreelanceId(offerId)||!validFreelanceId(occurrenceId)||confirmed!==true)throw new Error('FREELANCE_INVALID');
  const offerRef=adminDb.doc(offers+'/'+offerId);
  const occurrenceRef=offerRef.collection('occurrences').doc(occurrenceId);
  return adminDb.runTransaction(async tx=>{
    const [o,r]=await tx.getAll(offerRef,occurrenceRef);
    const offer=o.data() as FreelanceOffer|undefined;
    const occurrence=r.data() as FreelanceOccurrence|undefined;
    if(!offer||offer.id!==offerId||!validFreelanceId(offer.selectedApplicantUid)||
       (actorUid!==offer.ownerUid&&actorUid!==offer.selectedApplicantUid))throw new Error('FREELANCE_FORBIDDEN');
    if(!occurrence||occurrence.id!==occurrenceId||occurrence.offerId!==offerId||occurrence.ownerUid!==offer.ownerUid||
       occurrence.applicantUid!==offer.selectedApplicantUid||offer.status!=='under_review'||offer.occurrenceId!==occurrence.id)throw new Error('FREELANCE_CONFLICT');
    const application=(await tx.get(offerRef.collection('applications').doc(offer.selectedApplicantUid))).data() as FreelanceApplication|undefined;
    if(!application||application.offerId!==offerId||application.ownerUid!==offer.ownerUid||application.applicantUid!==offer.selectedApplicantUid||
       application.status!=='under_review'||application.occurrenceId!==occurrence.id)throw new Error('FREELANCE_CONFLICT');
    const result=recordFreelanceOccurrenceResponse(occurrence,actorUid,position,confirmed,new Date().toISOString());
    if(result!==occurrence)tx.update(occurrenceRef,{response:result.response!});
    return result;
  });
}
