import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildCourierPayableObligationFromCapture,
  type EconomicObligation,
} from '../../shared/economicObligations.js';
import type { StoreEconomicLedgerEntry } from '../../shared/storeEconomicLedger.js';

const ADMIN_PATH = 'kyrub_admin/control_plane/admins';
const DELIVERIES = 'hub/renda/deliveries';
const CLAIMS = 'deliveryClaims';
const TRANSFERS = 'deliveryCustodyTransfers';
const INCIDENTS = 'deliveryComplianceIncidents';
const COMPLETIONS = 'deliveryCompletions';
const RECONCILIATIONS = 'deliveryFinancialReconciliations';
const EVENTS = 'deliveryFinancialReconciliationEvents';
const TERMS_TTL_MS = 24 * 60 * 60 * 1000;

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const id = (value: unknown): string => {
  const parsed = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(parsed)) throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_INVALID');
  return parsed;
};
const note = (value: unknown): string => {
  const parsed = clean(value);
  if (parsed.length < 10 || parsed.length > 500) throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_INVALID');
  return parsed;
};

export const validateCourierRemunerationSplit = (
  totalMinor: unknown, outgoingMinor: unknown, incomingMinor: unknown
): { amountMinor: number; outgoingMinor: number; incomingMinor: number } => {
  if (!Number.isSafeInteger(totalMinor) || Number(totalMinor) <= 0
      || !Number.isSafeInteger(outgoingMinor) || Number(outgoingMinor) < 0
      || !Number.isSafeInteger(incomingMinor) || Number(incomingMinor) < 0
      || Number(outgoingMinor) + Number(incomingMinor) !== Number(totalMinor)) {
    throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_SPLIT_INVALID');
  }
  return {
    amountMinor: Number(totalMinor),
    outgoingMinor: Number(outgoingMinor),
    incomingMinor: Number(incomingMinor),
  };
};

const supervisorActive = (profile: Record<string, unknown>, actor: string): boolean =>
  profile.uid === actor && profile.status === 'active'
  && ['super_admin', 'operations', 'compliance'].includes(clean(profile.role));

const invariant = (
  transfer: Record<string, unknown>,
  incident: Record<string, unknown>,
  delivery: Record<string, unknown>,
  claim: Record<string, unknown>,
  completionExists: boolean
): { originalId: string; recipientId: string; storeId: string; orderId: string } => {
  if (transfer.status !== 'evidence_recorded_pending_reconciliation'
    || !transfer.fromConfirmedAt || !transfer.toConfirmedAt || !transfer.supervisorConfirmedAt
    || incident.status !== 'transfer_evidence_confirmed_pending_reconciliation'
    || incident.source !== 'motofrete_qualification_revoked'
    || delivery.source !== 'kyrub-order'
    || delivery.status !== 'delivering' || claim.status !== 'delivering'
    || delivery.vehicleType !== 'motorcycle' || completionExists) {
    throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
  }
  const originalId = id(transfer.fromCourierId);
  const recipientId = id(transfer.toCourierId);
  const storeId = id(delivery.storeId);
  const orderId = id(delivery.sourceOrderId);
  if (originalId === recipientId
    || delivery.acceptedBy !== originalId
    || claim.courierId !== originalId
    || incident.courierId !== originalId
    || transfer.deliveryId !== delivery.id
    || transfer.operationalAssignment !== 'original_claim_retained'
    || transfer.compensationStatus !== 'reconciliation_required') {
    throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
  }
  return { originalId, recipientId, storeId, orderId };
};

type CapturedAuthority = {
  amountMinor: number;
  paymentId: string;
  sourceCaptureId: string;
  canonicalStoreId: string;
  unresolvedObligationIds: string[];
};
const snapshotFinancialAuthority = (
  captures: Array<Record<string, unknown>>,
  obligations: Array<Record<string, unknown>>,
  source: { deliveryId: string; orderId: string; canonicalStoreId: string; originalId: string }
): CapturedAuthority => {
  // Only one paid ledger capture can fund a delivery fee. No amount is ever
  // inferred from UI prices, user input or a standalone delivery payment field.
  if (captures.length !== 1) throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_SOURCE_UNAVAILABLE');
  const capture = captures[0] as unknown as StoreEconomicLedgerEntry;
  if (capture.kind !== 'payment_capture'
    || capture.orderId !== source.orderId
    || capture.storeId !== source.canonicalStoreId) {
    throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_SOURCE_UNAVAILABLE');
  }
  const payable = buildCourierPayableObligationFromCapture({
    capture, fulfillmentId: source.deliveryId, courierUserId: source.originalId,
  });
  if (!payable) throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_SOURCE_UNAVAILABLE');

  const relevant = obligations.filter(raw => {
    const obligation = raw as unknown as EconomicObligation;
    return obligation.kind === 'courier_payable' && obligation.fulfillmentId === source.deliveryId;
  });
  if (relevant.some(raw => raw.status === 'eligible' || raw.status === 'settled'
    || (raw.status !== 'pending' && raw.status !== 'reversed'))) {
    throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_OBLIGATION_CONFLICT');
  }
  // Pending obligations, especially paid waiting, are separate claims and
  // remain unchanged. They MUST be reconciled before any economic execution.
  return {
    amountMinor: payable.amountMinor,
    paymentId: payable.paymentId,
    sourceCaptureId: payable.sourceEconomicEntryId,
    canonicalStoreId: source.canonicalStoreId,
    unresolvedObligationIds: relevant
      .filter(raw => raw.status === 'pending')
      .map(raw => clean(raw.id)).sort(),
  };
};

export const proposeCourierRemunerationReconciliation = async (input: {
  deliveryId: string;
  operatorId: string;
  outgoingMinor: number;
  incomingMinor: number;
  reason: string;
}): Promise<{ deliveryId: string; status: string; totalMinor: number }> => {
  const deliveryId = id(input.deliveryId);
  const operatorId = id(input.operatorId);
  const explanation = note(input.reason);
  const operatorRef = adminDb.doc(`${ADMIN_PATH}/${operatorId}`);
  const transferRef = adminDb.doc(`${TRANSFERS}/${deliveryId}`);
  const deliveryRef = adminDb.doc(`${DELIVERIES}/${deliveryId}`);
  const claimRef = adminDb.doc(`${CLAIMS}/${deliveryId}`);
  const incidentRef = adminDb.doc(`${INCIDENTS}/${deliveryId}`);
  const completionRef = adminDb.doc(`${COMPLETIONS}/${deliveryId}`);
  const reconciliationRef = adminDb.doc(`${RECONCILIATIONS}/${deliveryId}`);
  const eventRef = adminDb.collection(EVENTS).doc();

  return adminDb.runTransaction(async transaction => {
    const [operator, transfer, delivery, claim, incident, completion, reconciliation] = await Promise.all([
      transaction.get(operatorRef), transaction.get(transferRef),
      transaction.get(deliveryRef), transaction.get(claimRef),
      transaction.get(incidentRef), transaction.get(completionRef),
      transaction.get(reconciliationRef),
    ]);
    if (!supervisorActive(rec(operator.data()), operatorId)) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN');
    }
    if (!delivery.exists || !claim.exists || !transfer.exists || !incident.exists) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const verified = invariant(rec(transfer.data()), rec(incident.data()),
      rec(delivery.data()), rec(claim.data()), completion.exists);
    if (operatorId === verified.originalId || operatorId === verified.recipientId) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN');
    }
    const tenant = await transaction.get(adminDb.doc(`tenants/${verified.storeId}`));
    const canonicalStoreId = id(tenant.data()?.canonicalStoreId);
    // Capture and payable queries must be in the same transaction as the
    // proposed reconciliation to detect late settlement or duplicated payment.
    const [captureSnap, obligationsSnap] = await Promise.all([
      transaction.get(adminDb.collection(`stores/${canonicalStoreId}/economicLedger`)
        .where('orderId','==',verified.orderId).limit(101)),
      transaction.get(adminDb.collection(`stores/${canonicalStoreId}/economicObligations`)
        .where('fulfillmentId','==',deliveryId).limit(101)),
    ]);
    if (captureSnap.size === 101 || obligationsSnap.size === 101) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_SOURCE_UNAVAILABLE');
    }
    const authoritative = snapshotFinancialAuthority(
      captureSnap.docs.map(x => rec(x.data())).filter(x => x.kind === 'payment_capture'),
      obligationsSnap.docs.map(x => rec(x.data())),
      { deliveryId, orderId: verified.orderId, canonicalStoreId, originalId: verified.originalId },
    );
    validateCourierRemunerationSplit(
      authoritative.amountMinor, input.outgoingMinor, input.incomingMinor
    );
    if (reconciliation.exists) {
      const old = rec(reconciliation.data());
      if (old.operatorId === operatorId && old.reason === explanation
        && old.outgoingMinor === input.outgoingMinor
        && old.incomingMinor === input.incomingMinor
        && old.amountMinor === authoritative.amountMinor
        && old.sourceCaptureId === authoritative.sourceCaptureId
        && old.paymentId === authoritative.paymentId
        && old.status === 'awaiting_courier_terms') {
        return { deliveryId, status: 'awaiting_courier_terms',
          totalMinor: authoritative.amountMinor };
      }
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const at = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(at.toMillis() + TERMS_TTL_MS);
    const authorityFingerprint = createHash('sha256')
      .update(JSON.stringify({ paymentId: authoritative.paymentId,
        captureId: authoritative.sourceCaptureId,
        amountMinor: authoritative.amountMinor, deliveryId,
        unresolved: authoritative.unresolvedObligationIds }))
      .digest('hex');
    transaction.create(reconciliationRef, {
      schemaVersion: 1,
      deliveryId,
      storeId: verified.storeId,
      canonicalStoreId,
      orderId: verified.orderId,
      fromCourierId: verified.originalId,
      toCourierId: verified.recipientId,
      operatorId,
      amountMinor: authoritative.amountMinor,
      outgoingMinor: input.outgoingMinor,
      incomingMinor: input.incomingMinor,
      paymentId: authoritative.paymentId,
      sourceCaptureId: authoritative.sourceCaptureId,
      authorityFingerprint,
      unresolvedObligationIds: authoritative.unresolvedObligationIds,
      status: 'awaiting_courier_terms',
      outgoingAcceptedAt: null, incomingAcceptedAt: null,
      independentReviewerId: '',
      reason: explanation, expiresAt, createdAt: at, updatedAt: at,
      settlementStatus: 'blocked_pending_manual_execution',
      operationalStatus: 'original_claim_retained',
    });
    transaction.create(eventRef, {
      schemaVersion: 1, deliveryId, actorId: operatorId,
      action: 'terms_proposed', amountMinor: authoritative.amountMinor,
      outgoingMinor: input.outgoingMinor, incomingMinor: input.incomingMinor,
      authorityFingerprint, createdAt: at,
    });
    return { deliveryId, status: 'awaiting_courier_terms',
      totalMinor: authoritative.amountMinor };
  });
};

export const acceptCourierRemunerationTerms = async (input: {
  deliveryId: string;
  actorId: string;
}): Promise<{ deliveryId: string; status: string }> => {
  const deliveryId = id(input.deliveryId);
  const actorId = id(input.actorId);
  const docRef = adminDb.doc(`${RECONCILIATIONS}/${deliveryId}`);
  const transferRef = adminDb.doc(`${TRANSFERS}/${deliveryId}`);
  const eventRef = adminDb.collection(EVENTS).doc();
  return adminDb.runTransaction(async transaction => {
    const [snapshot, transfer] = await Promise.all([
      transaction.get(docRef), transaction.get(transferRef),
    ]);
    if (!snapshot.exists || !transfer.exists) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const data = rec(snapshot.data());
    if (actorId !== data.fromCourierId && actorId !== data.toCourierId) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN');
    }
    const field = actorId === data.fromCourierId ? 'outgoingAcceptedAt' : 'incomingAcceptedAt';
    if (data[field]) return { deliveryId, status: clean(data.status) };
    if (data.status !== 'awaiting_courier_terms'
      || !(data.expiresAt instanceof Timestamp)
      || data.expiresAt.toMillis() <= Date.now()
      || rec(transfer.data()).status !== 'evidence_recorded_pending_reconciliation') {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const at = Timestamp.now();
    const nextStatus = (field === 'outgoingAcceptedAt'
      ? Boolean(data.incomingAcceptedAt) : Boolean(data.outgoingAcceptedAt))
      ? 'awaiting_independent_review' : 'awaiting_courier_terms';
    transaction.update(docRef, {
      [field]: at,
      status: nextStatus,
      updatedAt: at,
    });
    transaction.create(eventRef, {
      schemaVersion: 1, deliveryId, actorId,
      action: field === 'outgoingAcceptedAt' ? 'outgoing_terms_accepted' : 'incoming_terms_accepted',
      amountMinor: data.amountMinor,
      outgoingMinor: data.outgoingMinor,
      incomingMinor: data.incomingMinor,
      authorityFingerprint: data.authorityFingerprint,
      createdAt: at,
    });
    return { deliveryId, status: nextStatus };
  });
};

export const approveCourierRemunerationReconciliation = async (input: {
  deliveryId: string;
  reviewerId: string;
  reason: string;
}): Promise<{ deliveryId: string; status: string }> => {
  const deliveryId = id(input.deliveryId);
  const reviewerId = id(input.reviewerId);
  const justification = note(input.reason);
  const ref = adminDb.doc(`${RECONCILIATIONS}/${deliveryId}`);
  const supervisorRef = adminDb.doc(`${ADMIN_PATH}/${reviewerId}`);
  const transferRef = adminDb.doc(`${TRANSFERS}/${deliveryId}`);
  const incidentRef = adminDb.doc(`${INCIDENTS}/${deliveryId}`);
  const deliveryRef = adminDb.doc(`${DELIVERIES}/${deliveryId}`);
  const claimRef = adminDb.doc(`${CLAIMS}/${deliveryId}`);
  const completionRef = adminDb.doc(`${COMPLETIONS}/${deliveryId}`);
  const eventRef = adminDb.collection(EVENTS).doc();
  return adminDb.runTransaction(async transaction => {
    const [snapshot, supervisor, transfer, incident, delivery, claim, completion] = await Promise.all([
      transaction.get(ref), transaction.get(supervisorRef),
      transaction.get(transferRef), transaction.get(incidentRef),
      transaction.get(deliveryRef), transaction.get(claimRef),
      transaction.get(completionRef),
    ]);
    if (!supervisorActive(rec(supervisor.data()), reviewerId)) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN');
    }
    if (!snapshot.exists || !delivery.exists || !claim.exists || !incident.exists || !transfer.exists) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const data = rec(snapshot.data());
    if (reviewerId === data.operatorId || reviewerId === data.fromCourierId
      || reviewerId === data.toCourierId) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_FORBIDDEN');
    }
    if (data.status === 'approved_pending_manual_execution' && data.independentReviewerId === reviewerId) {
      return { deliveryId, status: 'approved_pending_manual_execution' };
    }
    if (data.status !== 'awaiting_independent_review'
      || !data.outgoingAcceptedAt || !data.incomingAcceptedAt
      || !(data.expiresAt instanceof Timestamp) || data.expiresAt.toMillis() <= Date.now()) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const verified = invariant(rec(transfer.data()), rec(incident.data()),
      rec(delivery.data()), rec(claim.data()), completion.exists);
    if (data.fromCourierId !== verified.originalId || data.toCourierId !== verified.recipientId
      || data.orderId !== verified.orderId || data.storeId !== verified.storeId) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const captureQuery = adminDb.collection(`stores/${data.canonicalStoreId}/economicLedger`)
      .where('orderId','==',verified.orderId).limit(101);
    const obligationsQuery = adminDb.collection(`stores/${data.canonicalStoreId}/economicObligations`)
      .where('fulfillmentId','==',deliveryId).limit(101);
    const [captureSnap, obligationsSnap] = await Promise.all([
      transaction.get(captureQuery), transaction.get(obligationsQuery),
    ]);
    if (captureSnap.size === 101 || obligationsSnap.size === 101) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_SOURCE_UNAVAILABLE');
    }
    const authority = snapshotFinancialAuthority(
      captureSnap.docs.map(x => rec(x.data())).filter(x => x.kind === 'payment_capture'),
      obligationsSnap.docs.map(x => rec(x.data())),
      { deliveryId, orderId: verified.orderId, canonicalStoreId: clean(data.canonicalStoreId),
        originalId: verified.originalId },
    );
    validateCourierRemunerationSplit(
      authority.amountMinor, data.outgoingMinor, data.incomingMinor
    );
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ paymentId: authority.paymentId,
        captureId: authority.sourceCaptureId, amountMinor: authority.amountMinor,
        deliveryId, unresolved: authority.unresolvedObligationIds }))
      .digest('hex');
    if (fingerprint !== data.authorityFingerprint || authority.paymentId !== data.paymentId
      || authority.amountMinor !== data.amountMinor) {
      throw new Error('DELIVERY_FINANCIAL_RECONCILIATION_CONFLICT');
    }
    const at = Timestamp.now();
    transaction.update(ref, {
      status: 'approved_pending_manual_execution',
      independentReviewerId: reviewerId,
      independentReviewedAt: at,
      independentReviewReason: justification,
      updatedAt: at,
    });
    transaction.create(eventRef, {
      schemaVersion: 1, deliveryId, actorId: reviewerId,
      action: 'independent_review_approved',
      amountMinor: data.amountMinor,
      outgoingMinor: data.outgoingMinor,
      incomingMinor: data.incomingMinor,
      authorityFingerprint: data.authorityFingerprint,
      createdAt: at,
    });
    // Intentional safety boundary: do NOT create eligible/settled payables,
    // disburse funds or reassign the live delivery here. Pending paid-waiting
    // obligations must be reconciled separately by the economic subsystem.
    return { deliveryId, status: 'approved_pending_manual_execution' };
  });
};
