import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

const REVIEW_EVENTS = 'motofreteReviewEvents';
const COMPLIANCE_HOLDS = 'courierComplianceHolds';
const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const DELIVERY_INCIDENTS = 'deliveryComplianceIncidents';
const MAX_VALIDITY_MS = 180 * 24 * 60 * 60 * 1000;

export type MotofreteReviewDecision = 'approved' | 'rejected' | 'revoked';
export const MOTO_CHECKLIST = [
  'courseVerified',
  'minimumAgeAndLicenseTenureVerified',
  'vehicleRegistrationAndAuthorizationVerified',
  'safetyEquipmentVerified',
  'semiannualInspectionVerified',
  'localRequirementsVerified',
] as const;
type ChecklistKey = typeof MOTO_CHECKLIST[number];

export interface MotofreteReviewInput {
  userId: string;
  reviewerId: string;
  decision: MotofreteReviewDecision;
  reason: string;
  validUntilEpochMs: number | null;
  checks: Record<ChecklistKey, boolean>;
}

export const validateMotofreteReview = (
  input: MotofreteReviewInput, nowMs: number
): { validUntil: Timestamp | null; checks: Record<ChecklistKey, boolean> } => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.userId) ||
      !/^[a-zA-Z0-9_-]{1,128}$/.test(input.reviewerId) ||
      input.userId === input.reviewerId) {
    throw new Error('COMPLIANCE_REVIEW_INVALID');
  }
  if (!['approved', 'rejected', 'revoked'].includes(input.decision)) {
    throw new Error('COMPLIANCE_REVIEW_INVALID');
  }
  const reason = input.reason.trim();
  if (reason.length > 500 || (input.decision !== 'approved' && !reason)
      || (input.decision === 'approved' && reason !== '')) {
    throw new Error('COMPLIANCE_REVIEW_INVALID');
  }
  const checks = Object.fromEntries(MOTO_CHECKLIST.map(key => [key, input.checks[key] === true])) as Record<ChecklistKey, boolean>;
  if (input.decision !== 'approved') {
    if (MOTO_CHECKLIST.some(key => input.checks[key] === true)) {
      throw new Error('COMPLIANCE_REVIEW_INVALID');
    }
    return { validUntil: null, checks };
  }
  const expiry = input.validUntilEpochMs;
  if (MOTO_CHECKLIST.some(key => input.checks[key] !== true)
    || typeof expiry !== 'number' || !Number.isFinite(expiry)
    || expiry <= nowMs || expiry > nowMs + MAX_VALIDITY_MS) {
    throw new Error('COMPLIANCE_REVIEW_INVALID');
  }
  return { validUntil: Timestamp.fromMillis(expiry), checks };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const reviewMotofreteWithAudit = async (
  input: MotofreteReviewInput
): Promise<{ eventId: string; incidentScanStatus: 'not_needed' | 'completed' | 'failed'; affectedDeliveries: number }> => {
  const at = Timestamp.now();
  const { validUntil, checks } = validateMotofreteReview(input, at.toMillis());
  const eventRef = adminDb.collection(REVIEW_EVENTS).doc();
  const reviewerRef = adminDb.doc(`kyrub_admin/control_plane/admins/${input.reviewerId}`);
  const identityRef = adminDb.doc(`identity_verifications/${input.userId}`);
  const holdRef = adminDb.doc(`${COMPLIANCE_HOLDS}/${input.userId}`);

  await adminDb.runTransaction(async transaction => {
    const [reviewerSnapshot, identitySnapshot] = await Promise.all([
      transaction.get(reviewerRef),
      transaction.get(identityRef),
    ]);
    const reviewer = asRecord(reviewerSnapshot.data());
    const identity = asRecord(identitySnapshot.data());
    const qualification = asRecord(identity.motofreteQualification);

    if (!reviewerSnapshot.exists || reviewer.status !== 'active'
      || !['super_admin', 'compliance'].includes(String(reviewer.role))
      || reviewer.uid !== input.reviewerId) {
      throw new Error('COMPLIANCE_REVIEW_FORBIDDEN');
    }
    if (!identitySnapshot.exists || identity.uid !== input.userId ||
      identity.status !== 'approved' ||
      !Array.isArray(identity.approvedProfiles) ||
      !identity.approvedProfiles.includes('motorized_courier')) {
      throw new Error('COMPLIANCE_REVIEW_CONFLICT');
    }
    const previousStatus = String(qualification.status || '');
    if (input.decision === 'revoked' ? previousStatus !== 'approved'
      : previousStatus !== 'submitted') {
      throw new Error('COMPLIANCE_REVIEW_CONFLICT');
    }
    const documents = asRecord(qualification.documents);
    if (['course', 'vehicle', 'inspection', 'equipment'].some(key =>
      typeof documents[key] !== 'string' ||
      !String(documents[key]).startsWith(`identity-verification/${input.userId}/document/`))) {
      throw new Error('COMPLIANCE_REVIEW_CONFLICT');
    }
    const fingerprint = sha256(documents);
    const reviewFields = {
      status: input.decision,
      reviewedBy: input.reviewerId,
      reviewedAt: at,
      reviewReason: input.reason.trim(),
      validUntil,
      ...checks,
    };
    transaction.update(identityRef, {
      ...Object.fromEntries(Object.entries(reviewFields).map(([key, value]) =>
        [`motofreteQualification.${key}`, value])),
      updatedAt: at,
    });
    // A transaction-created, server-only event is immutable for clients.
    // Never copy CPF, address, raw evidence URLs or files into the audit log.
    transaction.create(eventRef, {
      schemaVersion: 1,
      userId: input.userId,
      reviewerId: input.reviewerId,
      decision: input.decision,
      previousStatus,
      nextStatus: input.decision,
      reason: input.reason.trim(),
      evidenceFingerprint: fingerprint,
      checklist: checks,
      validUntil,
      createdAt: at,
    });
    // An authoritative hold is applied before any new status transition
    // can be accepted; it does NOT cancel an in-flight parcel or stop GPS.
    transaction.set(holdRef, {
      userId: input.userId,
      active: input.decision !== 'approved',
      reason: input.decision === 'approved' ? '' : 'Atestação específica de motofrete indisponível.',
      decision: input.decision,
      eventId: eventRef.id,
      updatedAt: at,
    });
  });

  if (input.decision !== 'revoked') {
    return { eventId: eventRef.id, incidentScanStatus: 'not_needed', affectedDeliveries: 0 };
  }

  // The global hold is already authoritative. Per-delivery incidents are an
  // operational index, not the source of authorization; failures must be shown.
  try {
    const assigned = await adminDb.collection(DELIVERY_COLLECTION)
      .where('acceptedBy', '==', input.userId)
      .limit(100).get();
    const affected = assigned.docs.filter(snapshot => {
      const delivery = asRecord(snapshot.data());
      return delivery.vehicleType === 'motorcycle'
        && ['accepted', 'delivering'].includes(String(delivery.status));
    });
    if (assigned.size === 100) {
      // A bounded scan cannot prove all active deliveries are indexed.
      throw new Error('COMPLIANCE_INCIDENT_SCAN_LIMIT');
    }
    const batch = adminDb.batch();
    for (const snapshot of affected) {
      const delivery = asRecord(snapshot.data());
      const incidentRef = adminDb.doc(`${DELIVERY_INCIDENTS}/${snapshot.id}`);
      batch.set(incidentRef, {
        deliveryId: snapshot.id,
        courierId: input.userId,
        storeId: String(delivery.storeId || ''),
        deliveryStatusAtReview: String(delivery.status),
        status: 'awaiting_logistics_review',
        source: 'motofrete_qualification_revoked',
        eventId: eventRef.id,
        reviewedBy: input.reviewerId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    if (affected.length) await batch.commit();
    return { eventId: eventRef.id, incidentScanStatus: 'completed', affectedDeliveries: affected.length };
  } catch (error) {
    console.error('[Motofrete incident materialization]', error);
    return { eventId: eventRef.id, incidentScanStatus: 'failed', affectedDeliveries: 0 };
  }
};
