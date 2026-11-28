import { adminDb } from '../firebaseAdmin.js';
import { createFreelanceOffer, createFreelanceApplication, validFreelanceId, selectFreelanceApplicant, confirmFreelanceSelection, type FreelanceSelectionResult, type FreelanceOffer, type FreelanceApplication } from '../../shared/freelanceLifecycle.js';

const offers = 'freelanceOffersV1';
const eligibility = (uid: string) => adminDb.doc('identity_verifications/' + uid);
const assertApproved = (data: Record<string, unknown> | undefined, profile: 'requester' | 'freelancer') => {
  if (data?.status !== 'approved' || !Array.isArray(data.approvedProfiles) || !data.approvedProfiles.includes(profile)) {
    throw new Error('IDENTITY_VERIFICATION_REQUIRED');
  }
};

/** Service-only candidate: no public transport, no client writes and no migration of legacy records. */
export async function publishFreelanceOffer(actorUid: string, offerId: string, input: unknown): Promise<{offer:FreelanceOffer;created:boolean}> {
  const proposed = createFreelanceOffer(offerId, actorUid, input, new Date().toISOString());
  const ref = adminDb.doc(offers + '/' + offerId);
  return adminDb.runTransaction(async tx => {
    const [identity, existing] = await tx.getAll(eligibility(actorUid), ref);
    assertApproved(identity.data(), 'requester');
    if (existing.exists) {
      const saved = existing.data() as FreelanceOffer;
      if (saved.id !== proposed.id || saved.ownerUid !== actorUid || saved.status !== 'open' ||
          saved.title !== proposed.title || saved.description !== proposed.description ||
          saved.requirements !== proposed.requirements || saved.paymentMinor !== proposed.paymentMinor) throw new Error('FREELANCE_CONFLICT');
      return {offer:saved,created:false};
    }
    tx.create(ref, proposed);
    return {offer:proposed,created:true};
  });
}
export async function applyToFreelanceOffer(actorUid: string, offerId: string): Promise<{application:FreelanceApplication;created:boolean}> {
  if (!validFreelanceId(actorUid) || !validFreelanceId(offerId)) throw new Error('FREELANCE_INVALID');
  const offerRef = adminDb.doc(offers + '/' + offerId);
  const applicationRef = offerRef.collection('applications').doc(actorUid);
  return adminDb.runTransaction(async tx => {
    const [identity, offerSnap, applicationSnap] = await tx.getAll(eligibility(actorUid),offerRef,applicationRef);
    assertApproved(identity.data(),'freelancer');
    const offer = offerSnap.data() as FreelanceOffer | undefined;
    if (!offerSnap.exists || !offer || offer.id !== offerId) throw new Error('FREELANCE_FORBIDDEN');
    const proposed = createFreelanceApplication(offer,actorUid,new Date().toISOString());
    if (applicationSnap.exists) {
      const saved = applicationSnap.data() as FreelanceApplication;
      if (saved.offerId !== offerId || saved.applicantUid !== actorUid || saved.ownerUid !== offer.ownerUid || saved.status !== 'pending') throw new Error('FREELANCE_CONFLICT');
      return {application:saved,created:false};
    }
    tx.create(applicationRef,proposed);
    return {application:proposed,created:true};
  });
}

/** Both actors are revalidated in the same transaction as the selection. */
export async function selectFreelanceApplication(actorUid: string, offerId: string, applicantUid: string): Promise<FreelanceSelectionResult> {
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
    const result = selectFreelanceApplicant(offer,application,actorUid,new Date().toISOString());
    if (result.changed) {
      tx.update(offerRef,{status:result.offer.status,selectedApplicantUid:result.offer.selectedApplicantUid!,selectedAt:result.offer.selectedAt!});
      tx.update(applicationRef,{status:result.application.status,selectedAt:result.application.selectedAt!});
    }
    return result;
  });
}
/** The selected worker must explicitly confirm; the owner cannot confirm for them. */
export async function confirmFreelanceContract(actorUid: string, offerId: string, confirmed: unknown): Promise<FreelanceSelectionResult> {
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
    const result = confirmFreelanceSelection(offer,application,actorUid,confirmed,new Date().toISOString());
    if (result.changed) {
      tx.update(offerRef,{status:result.offer.status,contractedAt:result.offer.contractedAt!});
      tx.update(applicationRef,{status:result.application.status,contractedAt:result.application.contractedAt!});
    }
    return result;
  });
}
