import { adminDb } from '../firebaseAdmin.js';
import { createFreelanceOffer, createFreelanceApplication, validFreelanceId, type FreelanceOffer, type FreelanceApplication } from '../../shared/freelanceLifecycle.js';

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
