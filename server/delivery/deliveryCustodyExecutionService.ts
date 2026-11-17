import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildCourierPayableObligationFromCapture,
} from '../../shared/economicObligations.js';
import type { StoreEconomicLedgerEntry } from '../../shared/storeEconomicLedger.js';
import {
  assessDeliveryCargo, courierVehicleDocumentEligibility,
  isCourierVehicleType,
} from '../../shared/deliveryVehicleCompatibility.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const data = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const safeId = (value: unknown): string => {
  const v = clean(value);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(v)) throw new Error('DELIVERY_CUSTODY_EXECUTION_INVALID');
  return v;
};
const description = (value: unknown): string => {
  const v = clean(value);
  if (v.length < 10 || v.length > 500) throw new Error('DELIVERY_CUSTODY_EXECUTION_INVALID');
  return v;
};

export const verifyCustodyExecutionPreconditions = (args: {
  transfer: Record<string, unknown>;
  incident: Record<string, unknown>;
  reconciliation: Record<string, unknown>;
  delivery: Record<string, unknown>;
  claim: Record<string, unknown>;
  recipientIdentity?: Record<string, unknown>;
  recipientHoldActive: boolean;
  originalHoldActive: boolean;
  order: Record<string, unknown>;
  hasCompletion: boolean;
}): {originalId: string; recipientId: string; vehicle: 'bicycle'|'motorcycle'|'car'} => {
  const {transfer,incident,reconciliation,delivery,claim,order} = args;
  const originalId = safeId(transfer.fromCourierId);
  const recipientId = safeId(transfer.toCourierId);
  const vehicle = transfer.targetVehicle;
  if (!isCourierVehicleType(vehicle)
      || transfer.status !== 'evidence_recorded_pending_reconciliation'
      || transfer.operationalAssignment !== 'original_claim_retained'
      || !transfer.fromConfirmedAt || !transfer.toConfirmedAt || !transfer.supervisorConfirmedAt
      || transfer.compensationStatus !== 'reconciliation_required'
      || incident.status !== 'transfer_evidence_confirmed_pending_reconciliation'
      || incident.source !== 'motofrete_qualification_revoked'
      || incident.courierId !== originalId
      || reconciliation.status !== 'approved_pending_manual_execution'
      || !reconciliation.outgoingAcceptedAt || !reconciliation.incomingAcceptedAt
      || !reconciliation.independentReviewedAt || !clean(reconciliation.independentReviewerId)
      || reconciliation.fromCourierId !== originalId || reconciliation.toCourierId !== recipientId
      || originalId === recipientId
      || reconciliation.orderId !== delivery.sourceOrderId
      || reconciliation.storeId !== delivery.storeId
      || delivery.source !== 'kyrub-order' || delivery.status !== 'delivering'
      || claim.status !== 'delivering' || delivery.acceptedBy !== originalId
      || claim.courierId !== originalId || delivery.vehicleType !== 'motorcycle'
      || !delivery.collectedAt || args.hasCompletion
      || !args.originalHoldActive || args.recipientHoldActive
      || order.fulfillmentType !== 'delivery' || order.deliveryProvider !== 'kyrub'
      || order.status !== 'out_for_delivery'
      || order.buyerId !== delivery.buyerId) {
    throw new Error('DELIVERY_CUSTODY_EXECUTION_CONFLICT');
  }
  const eligible = courierVehicleDocumentEligibility(args.recipientIdentity, vehicle);
  const cargo = assessDeliveryCargo(delivery.cargo);
  if (!eligible.eligible || !cargo.ready || !cargo.allowedVehicles.includes(vehicle)
    || !Number.isSafeInteger(reconciliation.amountMinor)
    || Number(reconciliation.amountMinor) <= 0
    || !Number.isSafeInteger(reconciliation.outgoingMinor)
    || !Number.isSafeInteger(reconciliation.incomingMinor)
    || Number(reconciliation.outgoingMinor) < 0
    || Number(reconciliation.incomingMinor) < 0
    || Number(reconciliation.outgoingMinor) + Number(reconciliation.incomingMinor) !== Number(reconciliation.amountMinor)) {
    throw new Error('DELIVERY_CUSTODY_EXECUTION_CONFLICT');
  }
  return {originalId, recipientId, vehicle};
};

export const executeSupervisedDeliveryReassignment = async (input: {
  deliveryId: string;
  executorId: string;
  reason: string;
}): Promise<{deliveryId: string; status: 'recipient_awaiting_delivery'; recipientId: string}> => {
  const deliveryId = safeId(input.deliveryId);
  const executorId = safeId(input.executorId);
  const justification = description(input.reason);
  const operatorRef = adminDb.doc(`kyrub_admin/control_plane/admins/${executorId}`);
  const deliveryRef = adminDb.doc(`hub/renda/deliveries/${deliveryId}`);
  const claimRef = adminDb.doc(`deliveryClaims/${deliveryId}`);
  const transferRef = adminDb.doc(`deliveryCustodyTransfers/${deliveryId}`);
  const incidentRef = adminDb.doc(`deliveryComplianceIncidents/${deliveryId}`);
  const reconciliationRef = adminDb.doc(`deliveryFinancialReconciliations/${deliveryId}`);
  const completionRef = adminDb.doc(`deliveryCompletions/${deliveryId}`);
  const trackingRef = adminDb.doc(`deliveryTracking/${deliveryId}`);
  const eventRef = adminDb.collection('deliveryCustodyTransferEvents').doc();
  const financialEventRef = adminDb.collection('deliveryFinancialReconciliationEvents').doc();

  return adminDb.runTransaction(async transaction => {
    const [operatorSnap,deliverySnap,claimSnap,transferSnap,incidentSnap,
      reconciliationSnap,completionSnap,trackingSnap] = await Promise.all([
      transaction.get(operatorRef),transaction.get(deliveryRef),
      transaction.get(claimRef),transaction.get(transferRef),
      transaction.get(incidentRef),transaction.get(reconciliationRef),
      transaction.get(completionRef),transaction.get(trackingRef),
    ]);
    const operator = data(operatorSnap.data());
    if (operator.uid !== executorId || operator.status !== 'active' || operator.role !== 'super_admin') {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_FORBIDDEN');
    }
    if (!deliverySnap.exists || !claimSnap.exists || !transferSnap.exists
      || !incidentSnap.exists || !reconciliationSnap.exists) {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_CONFLICT');
    }
    const transfer = data(transferSnap.data());
    const finance = data(reconciliationSnap.data());
    const delivery = data(deliverySnap.data());
    const claim = data(claimSnap.data());
    const incident = data(incidentSnap.data());
    if (transfer.status === 'operational_reassigned'
      && finance.status === 'operational_reassigned_awaiting_buyer_confirmation'
      && clean(delivery.acceptedBy) === clean(transfer.toCourierId)
      && clean(claim.courierId) === clean(transfer.toCourierId)
      && clean(transfer.executedBy) === executorId
      && clean(transfer.executionReason) === justification) {
      return {deliveryId,status:'recipient_awaiting_delivery',recipientId:safeId(transfer.toCourierId)};
    }
    const originalId = safeId(transfer.fromCourierId);
    const recipientId = safeId(transfer.toCourierId);
    if ([originalId, recipientId].includes(executorId)
      || executorId === finance.operatorId || executorId === finance.independentReviewerId
      || executorId === transfer.operatorId || executorId === transfer.supervisorConfirmedBy) {
      // Third independent executor, not an author or beneficiary.
      throw new Error('DELIVERY_CUSTODY_EXECUTION_FORBIDDEN');
    }
    const [recipientIdentity,recipientHold,originalHold,orderSnap,tenantSnap] = await Promise.all([
      transaction.get(adminDb.doc(`identity_verifications/${recipientId}`)),
      transaction.get(adminDb.doc(`courierComplianceHolds/${recipientId}`)),
      transaction.get(adminDb.doc(`courierComplianceHolds/${originalId}`)),
      transaction.get(adminDb.doc(`artifacts/${safeId(delivery.storeId)}/public/data/customerOrders/${safeId(delivery.sourceOrderId)}`)),
      transaction.get(adminDb.doc(`tenants/${safeId(delivery.storeId)}`)),
    ]);
    verifyCustodyExecutionPreconditions({
      transfer,incident,reconciliation:finance,delivery,claim,
      recipientIdentity:recipientIdentity.data(),
      recipientHoldActive:recipientHold.data()?.active === true,
      originalHoldActive:originalHold.data()?.active === true,
      order:data(orderSnap.data()),hasCompletion:completionSnap.exists,
    });
    const canonicalStoreId = safeId(tenantSnap.data()?.canonicalStoreId);
    if (canonicalStoreId !== finance.canonicalStoreId) {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_CONFLICT');
    }
    const [captureSnaps,obligationSnaps] = await Promise.all([
      transaction.get(adminDb.collection(`stores/${canonicalStoreId}/economicLedger`)
        .where('orderId','==',safeId(delivery.sourceOrderId)).limit(101)),
      transaction.get(adminDb.collection(`stores/${canonicalStoreId}/economicObligations`)
        .where('fulfillmentId','==',deliveryId).limit(101)),
    ]);
    if (captureSnaps.size === 101 || obligationSnaps.size === 101) {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_FINANCIAL_CONFLICT');
    }
    const captures = captureSnaps.docs.map(doc => data(doc.data()))
      .filter(row => row.kind === 'payment_capture');
    if (captures.length !== 1) throw new Error('DELIVERY_CUSTODY_EXECUTION_FINANCIAL_CONFLICT');
    const capture = captures[0] as unknown as StoreEconomicLedgerEntry;
    if (capture.storeId !== canonicalStoreId || capture.orderId !== delivery.sourceOrderId
      || capture.id !== finance.sourceCaptureId || capture.paymentId !== finance.paymentId) {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_FINANCIAL_CONFLICT');
    }
    const authoritative = buildCourierPayableObligationFromCapture({
      capture,fulfillmentId:deliveryId,courierUserId:originalId,
    });
    if (!authoritative || authoritative.amountMinor !== finance.amountMinor) {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_FINANCIAL_CONFLICT');
    }
    const obligations = obligationSnaps.docs.map(doc => data(doc.data()))
      .filter(row => row.kind === 'courier_payable');
    // A separate waiting fee or existing full-fee payable must be accounted
    // for explicitly first. No attempt to reverse a prior credit silently.
    if (obligations.some(row => row.status !== 'reversed')) {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_OUTSTANDING_OBLIGATIONS');
    }
    const unresolvedIds = obligations.filter(row => row.status === 'pending')
      .map(row => clean(row.id)).sort();
    const fingerprint = createHash('sha256').update(JSON.stringify({
      paymentId:capture.paymentId,captureId:capture.id,
      amountMinor:authoritative.amountMinor,deliveryId,unresolved:unresolvedIds,
    })).digest('hex');
    if (fingerprint !== finance.authorityFingerprint
      || (Array.isArray(finance.unresolvedObligationIds)
        && finance.unresolvedObligationIds.length !== unresolvedIds.length)) {
      throw new Error('DELIVERY_CUSTODY_EXECUTION_FINANCIAL_CONFLICT');
    }
    const at = Timestamp.now();
    transaction.update(claimRef, {
      courierId:recipientId,vehicleType:transfer.targetVehicle,
      previousCourierId:originalId,
      custodyTransferId:deliveryId,
      custodyReassignedAt:at,
      customerHandoff:FieldValue.delete(),
      updatedAt:at,
    });
    transaction.update(deliveryRef, {
      acceptedBy:recipientId, acceptedByName:'Entregador substituto',
      vehicleType:transfer.targetVehicle, previousCourierId:originalId,
      custodyTransferId:deliveryId,custodyReassignedAt:at,
      customerHandoff:FieldValue.delete(),
      updatedAt:at,
    });
    // Starting the recipient's GPS must require a fresh authenticated device
    // position; never show an old latitude/longitude as their current location.
    transaction.set(trackingRef, {
      deliveryId,courierId:recipientId,active:false,
      latitude:FieldValue.delete(),longitude:FieldValue.delete(),
      accuracy:FieldValue.delete(),heading:FieldValue.delete(),
      speed:FieldValue.delete(),clientCapturedAt:FieldValue.delete(),
      storeArrivalEvidence:FieldValue.delete(),customerArrivalEvidence:FieldValue.delete(),
      storeArrivalAssessment:FieldValue.delete(),customerArrivalAssessment:FieldValue.delete(),
      updatedAt:at,endedAt:at,endReason:'custody_reassigned_waiting_new_gps',
    },{merge:true});
    transaction.update(transferRef, {
      status:'operational_reassigned',
      operationalAssignment:'recipient_claim_active',
      executedBy:executorId,executionReason:justification,executedAt:at,updatedAt:at,
    });
    transaction.update(incidentRef, {
      status:'reassigned_awaiting_buyer_confirmation',updatedAt:at,
    });
    transaction.update(reconciliationRef, {
      status:'operational_reassigned_awaiting_buyer_confirmation',
      settlementStatus:'held_until_buyer_confirmation',
      operationalStatus:'recipient_claim_active',executedAt:at,
      executorId,updatedAt:at,
    });
    transaction.create(eventRef, {
      schemaVersion:1,deliveryId,actorId:executorId,actorRole:'super_admin',
      action:'operational_reassigned',
      fromCourierId:originalId,toCourierId:recipientId,
      targetVehicle:transfer.targetVehicle,createdAt:at,
    });
    transaction.create(financialEventRef, {
      schemaVersion:1,deliveryId,actorId:executorId,
      action:'safe_operational_reassignment',
      amountMinor:finance.amountMinor,outgoingMinor:finance.outgoingMinor,
      incomingMinor:finance.incomingMinor,authorityFingerprint:finance.authorityFingerprint,
      createdAt:at,
    });
    // Not a settlement: buyer confirmation is the only trigger to create
    // two eligible split payables, and no payment provider is called here.
    return {deliveryId,status:'recipient_awaiting_delivery',recipientId};
  });
};
