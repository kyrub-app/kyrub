import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  assessDeliveryCargo,
  courierVehicleDocumentEligibility,
  isCourierVehicleType,
  type CourierVehicleType,
} from '../../shared/deliveryVehicleCompatibility.js';

const INCIDENT_COLLECTION = 'deliveryComplianceIncidents';
const TRANSFERS = 'deliveryCustodyTransfers';
const EVENTS = 'deliveryCustodyTransferEvents';
const DELIVERIES = 'hub/renda/deliveries';
const CLAIMS = 'deliveryClaims';
const HOLDS = 'courierComplianceHolds';
const IDENTITIES = 'identity_verifications';
const ADMINS = 'kyrub_admin/control_plane/admins';
export const SUPERVISED_TRANSFER_TTL_MS = 30 * 60_000;

const clean = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const validId = (v: unknown): string => {
  const id = clean(v);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error('CUSTODY_TRANSFER_INVALID');
  return id;
};
const reason = (v: unknown): string => {
  const text = clean(v);
  if (text.length < 10 || text.length > 500) throw new Error('CUSTODY_TRANSFER_INVALID');
  return text;
};

export type TransferParty = 'from' | 'to';
export type TransferStatus =
  | 'awaiting_participant_confirmations'
  | 'awaiting_supervisor_review'
  | 'evidence_recorded_pending_reconciliation';

export const assessSupervisedTransfer = (input: {
  incidentStatus: string;
  incidentSource: string;
  deliveryStatus: string;
  claimStatus: string;
  deliverySource: string;
  fromCourierId: string;
  claimCourierId: string;
  deliveryCourierId: string;
  vehicleType: string;
  pickupConfirmed: boolean;
  completionExists: boolean;
  holdActive: boolean;
  toCourierId: string;
  targetVehicle: CourierVehicleType;
  targetIdentity: Record<string, unknown> | undefined;
  targetHoldActive: boolean;
  cargo: unknown;
}): { allowed: boolean; reason: string } => {
  const failed = (message: string) => ({ allowed: false, reason: message });
  if (input.incidentStatus !== 'awaiting_supervised_handoff'
    || input.incidentSource !== 'motofrete_qualification_revoked'
    || input.deliveryStatus !== 'delivering'
    || input.claimStatus !== 'delivering'
    || input.deliverySource !== 'kyrub-order'
    || input.vehicleType !== 'motorcycle'
    || !input.fromCourierId || input.fromCourierId === input.toCourierId
    || input.fromCourierId !== input.claimCourierId
    || input.fromCourierId !== input.deliveryCourierId
    || !input.pickupConfirmed || input.completionExists || !input.holdActive) {
    return failed('A entrega não está em custódia supervisionada ou já mudou de fase.');
  }
  const eligible = courierVehicleDocumentEligibility(input.targetIdentity, input.targetVehicle);
  if (!eligible.eligible || input.targetHoldActive) {
    return failed('O substituto não está elegível para a modalidade escolhida.');
  }
  const cargo = assessDeliveryCargo(input.cargo);
  if (!cargo.ready || !cargo.allowedVehicles.includes(input.targetVehicle)) {
    return failed('A modalidade do substituto não comporta a carga declarada.');
  }
  return { allowed: true, reason: '' };
};

type TransferSnapshot = Record<string, unknown>;
const transferStage = (value: unknown): TransferStatus | '' =>
  value === 'awaiting_participant_confirmations'
  || value === 'awaiting_supervisor_review'
  || value === 'evidence_recorded_pending_reconciliation'
    ? value : '';

const assertSupervisor = (profile: Record<string, unknown>, actorId: string) => {
  if (profile.uid !== actorId || profile.status !== 'active'
    || !['super_admin','operations','compliance'].includes(clean(profile.role))) {
    throw new Error('CUSTODY_TRANSFER_FORBIDDEN');
  }
};

const assertAssignment = (
  incident: TransferSnapshot, delivery: TransferSnapshot, claim: TransferSnapshot,
  courierId: string
) => {
  if (incident.status !== 'awaiting_supervised_handoff'
    || incident.source !== 'motofrete_qualification_revoked'
    || clean(incident.courierId) !== courierId
    || clean(delivery.acceptedBy) !== courierId
    || clean(claim.courierId) !== courierId
    || delivery.status !== 'delivering'
    || claim.status !== 'delivering'
    || delivery.vehicleType !== 'motorcycle'
    || delivery.source !== 'kyrub-order'
    || !delivery.collectedAt) {
    throw new Error('CUSTODY_TRANSFER_CONFLICT');
  }
};

export const proposeSupervisedCustodyTransfer = async (input: {
  deliveryId: string;
  operatorId: string;
  toCourierId: string;
  targetVehicle: unknown;
  reason: string;
}): Promise<{ deliveryId: string; status: TransferStatus; expiresAtEpochMs: number }> => {
  const id = validId(input.deliveryId);
  const operatorId = validId(input.operatorId);
  const toCourierId = validId(input.toCourierId);
  const explanation = reason(input.reason);
  if (!isCourierVehicleType(input.targetVehicle) || operatorId === toCourierId) {
    throw new Error('CUSTODY_TRANSFER_INVALID');
  }
  const vehicle: CourierVehicleType = input.targetVehicle;
  const incidentRef = adminDb.doc(`${INCIDENT_COLLECTION}/${id}`);
  const transferRef = adminDb.doc(`${TRANSFERS}/${id}`);
  const deliveryRef = adminDb.doc(`${DELIVERIES}/${id}`);
  const claimRef = adminDb.doc(`${CLAIMS}/${id}`);
  const operatorRef = adminDb.doc(`${ADMINS}/${operatorId}`);
  const recipientIdentityRef = adminDb.doc(`${IDENTITIES}/${toCourierId}`);
  const recipientHoldRef = adminDb.doc(`${HOLDS}/${toCourierId}`);
  const eventRef = adminDb.collection(EVENTS).doc();
  return adminDb.runTransaction(async transaction => {
    const [operator, incident, transfer, delivery, claim, recipientIdentity, recipientHold] = await Promise.all([
      transaction.get(operatorRef),
      transaction.get(incidentRef),
      transaction.get(transferRef),
      transaction.get(deliveryRef),
      transaction.get(claimRef),
      transaction.get(recipientIdentityRef),
      transaction.get(recipientHoldRef),
    ]);
    assertSupervisor(obj(operator.data()), operatorId);
    if (!incident.exists || !delivery.exists || !claim.exists) throw new Error('CUSTODY_TRANSFER_CONFLICT');
    const incidentData = obj(incident.data());
    const deliveryData = obj(delivery.data());
    const claimData = obj(claim.data());
    const fromCourierId = validId(incidentData.courierId);
    assertAssignment(incidentData, deliveryData, claimData, fromCourierId);
    if (fromCourierId === toCourierId) throw new Error('CUSTODY_TRANSFER_INVALID');
    const fromHoldRef = adminDb.doc(`${HOLDS}/${fromCourierId}`);
    const completionRef = adminDb.doc(`deliveryCompletions/${id}`);
    const [fromHold, completion] = await Promise.all([
      transaction.get(fromHoldRef),
      transaction.get(completionRef),
    ]);
    const assessment = assessSupervisedTransfer({
      incidentStatus: clean(incidentData.status),
      incidentSource: clean(incidentData.source),
      deliveryStatus: clean(deliveryData.status),
      claimStatus: clean(claimData.status),
      deliverySource: clean(deliveryData.source),
      fromCourierId,
      claimCourierId: clean(claimData.courierId),
      deliveryCourierId: clean(deliveryData.acceptedBy),
      vehicleType: clean(deliveryData.vehicleType),
      pickupConfirmed: Boolean(deliveryData.collectedAt),
      completionExists: completion.exists,
      holdActive: fromHold.data()?.active === true,
      toCourierId,
      targetVehicle: vehicle,
      targetIdentity: recipientIdentity.data() as Record<string, unknown> | undefined,
      targetHoldActive: recipientHold.data()?.active === true,
      cargo: deliveryData.cargo,
    });
    if (!assessment.allowed) throw new Error('CUSTODY_TRANSFER_CONFLICT:' + assessment.reason);
    if (transfer.exists) {
      const existing = obj(transfer.data());
      const currentStage = transferStage(existing.status);
      if (currentStage
        && existing.fromCourierId === fromCourierId
        && existing.toCourierId === toCourierId
        && existing.targetVehicle === vehicle
        && existing.operatorId === operatorId
        && existing.reason === explanation) {
        const expire = existing.expiresAt as Timestamp | undefined;
        return {
          deliveryId: id,
          status: currentStage,
          expiresAtEpochMs: expire?.toMillis() ?? 0,
        };
      }
      throw new Error('CUSTODY_TRANSFER_CONFLICT');
    }
    const at = Timestamp.now();
    const expiresAt = Timestamp.fromMillis(at.toMillis() + SUPERVISED_TRANSFER_TTL_MS);
    transaction.create(transferRef, {
      schemaVersion: 1,
      deliveryId: id,
      incidentId: id,
      fromCourierId,
      toCourierId,
      targetVehicle: vehicle,
      operatorId,
      reason: explanation,
      status: 'awaiting_participant_confirmations',
      fromConfirmedAt: null,
      toConfirmedAt: null,
      supervisorConfirmedAt: null,
      expiresAt,
      createdAt: at,
      updatedAt: at,
      // No operational reassignment or money changes are authorized here.
      operationalAssignment: 'original_claim_retained',
      compensationStatus: 'reconciliation_required',
    });
    transaction.create(eventRef, {
      schemaVersion: 1, deliveryId: id, actorId: operatorId,
      actorRole: 'supervisor', action: 'proposed',
      fromCourierId, toCourierId, targetVehicle: vehicle,
      createdAt: at,
    });
    return {
      deliveryId: id,
      status: 'awaiting_participant_confirmations',
      expiresAtEpochMs: expiresAt.toMillis(),
    };
  });
};

export const acknowledgeSupervisedCustodyTransfer = async (input: {
  deliveryId: string;
  actorId: string;
  statement: 'physically_handed_over' | 'physically_received';
}): Promise<{ deliveryId: string; status: TransferStatus }> => {
  const id = validId(input.deliveryId);
  const actorId = validId(input.actorId);
  if (!['physically_handed_over', 'physically_received'].includes(input.statement)) {
    throw new Error('CUSTODY_TRANSFER_INVALID');
  }
  const transferRef = adminDb.doc(`${TRANSFERS}/${id}`);
  const deliveryRef = adminDb.doc(`${DELIVERIES}/${id}`);
  const claimRef = adminDb.doc(`${CLAIMS}/${id}`);
  const incidentRef = adminDb.doc(`${INCIDENT_COLLECTION}/${id}`);
  const eventRef = adminDb.collection(EVENTS).doc();
  return adminDb.runTransaction(async transaction => {
    const [transfer, delivery, claim, incident] = await Promise.all([
      transaction.get(transferRef), transaction.get(deliveryRef),
      transaction.get(claimRef), transaction.get(incidentRef),
    ]);
    if (!transfer.exists || !delivery.exists || !claim.exists || !incident.exists) {
      throw new Error('CUSTODY_TRANSFER_CONFLICT');
    }
    const t = obj(transfer.data());
    const fromCourierId = validId(t.fromCourierId);
    const toCourierId = validId(t.toCourierId);
    const party: TransferParty = actorId === fromCourierId ? 'from' : 'to';
    if (actorId !== fromCourierId && actorId !== toCourierId) {
      throw new Error('CUSTODY_TRANSFER_FORBIDDEN');
    }
    if ((party === 'from' && input.statement !== 'physically_handed_over')
      || (party === 'to' && input.statement !== 'physically_received')) {
      throw new Error('CUSTODY_TRANSFER_INVALID');
    }
    assertAssignment(obj(incident.data()), obj(delivery.data()), obj(claim.data()), fromCourierId);
    const confirmedKey = party === 'from' ? 'fromConfirmedAt' : 'toConfirmedAt';
    if (t[confirmedKey]) {
      return { deliveryId: id, status: transferStage(t.status) || 'awaiting_participant_confirmations' };
    }
    if (t.status !== 'awaiting_participant_confirmations'
      || !(t.expiresAt instanceof Timestamp)
      || t.expiresAt.toMillis() <= Date.now()) {
      throw new Error('CUSTODY_TRANSFER_EXPIRED_OR_CONFLICT');
    }
    const targetVehicle = t.targetVehicle;
    if (!isCourierVehicleType(targetVehicle)) throw new Error('CUSTODY_TRANSFER_CONFLICT');
    const recipientIdentityRef = adminDb.doc(`${IDENTITIES}/${toCourierId}`);
    const recipientHoldRef = adminDb.doc(`${HOLDS}/${toCourierId}`);
    const [identity, hold] = await Promise.all([
      transaction.get(recipientIdentityRef), transaction.get(recipientHoldRef),
    ]);
    const eligibility = courierVehicleDocumentEligibility(
      identity.data() as Record<string, unknown> | undefined, targetVehicle
    );
    if (!eligibility.eligible || hold.data()?.active === true) {
      throw new Error('CUSTODY_TRANSFER_CONFLICT');
    }
    const at = Timestamp.now();
    const secondConfirmed = party === 'from' ? Boolean(t.toConfirmedAt) : Boolean(t.fromConfirmedAt);
    const status: TransferStatus = secondConfirmed
      ? 'awaiting_supervisor_review' : 'awaiting_participant_confirmations';
    transaction.update(transferRef, {
      [confirmedKey]: at,
      status,
      updatedAt: at,
    });
    transaction.create(eventRef, {
      schemaVersion: 1, deliveryId: id, actorId,
      actorRole: party, action: input.statement,
      fromCourierId, toCourierId, createdAt: at,
    });
    return { deliveryId: id, status };
  });
};

export const attestSupervisedCustodyTransfer = async (input: {
  deliveryId: string;
  supervisorId: string;
  note: string;
}): Promise<{ deliveryId: string; status: TransferStatus }> => {
  const id = validId(input.deliveryId);
  const supervisorId = validId(input.supervisorId);
  const note = reason(input.note);
  const transferRef = adminDb.doc(`${TRANSFERS}/${id}`);
  const incidentRef = adminDb.doc(`${INCIDENT_COLLECTION}/${id}`);
  const deliveryRef = adminDb.doc(`${DELIVERIES}/${id}`);
  const claimRef = adminDb.doc(`${CLAIMS}/${id}`);
  const supervisorRef = adminDb.doc(`${ADMINS}/${supervisorId}`);
  const eventRef = adminDb.collection(EVENTS).doc();
  return adminDb.runTransaction(async transaction => {
    const [transfer, incident, delivery, claim, supervisor] = await Promise.all([
      transaction.get(transferRef), transaction.get(incidentRef),
      transaction.get(deliveryRef), transaction.get(claimRef),
      transaction.get(supervisorRef),
    ]);
    assertSupervisor(obj(supervisor.data()), supervisorId);
    if (!transfer.exists || !incident.exists || !delivery.exists || !claim.exists) {
      throw new Error('CUSTODY_TRANSFER_CONFLICT');
    }
    const t = obj(transfer.data());
    const fromCourierId = validId(t.fromCourierId);
    const toCourierId = validId(t.toCourierId);
    if (supervisorId === fromCourierId || supervisorId === toCourierId) {
      throw new Error('CUSTODY_TRANSFER_FORBIDDEN');
    }
    if (t.status === 'evidence_recorded_pending_reconciliation'
      && t.supervisorConfirmedBy === supervisorId) {
      // Exact replay is idempotent; the original event remains the only
      // attestation and no second economic or custody action is executed.
      return { deliveryId: id, status: 'evidence_recorded_pending_reconciliation' };
    }
    assertAssignment(obj(incident.data()), obj(delivery.data()), obj(claim.data()), fromCourierId);
    if (t.status !== 'awaiting_supervisor_review'
      || !t.fromConfirmedAt || !t.toConfirmedAt
      || !(t.expiresAt instanceof Timestamp)
      || t.expiresAt.toMillis() <= Date.now()) {
      throw new Error('CUSTODY_TRANSFER_EXPIRED_OR_CONFLICT');
    }
    const targetVehicle = t.targetVehicle;
    if (!isCourierVehicleType(targetVehicle)) throw new Error('CUSTODY_TRANSFER_CONFLICT');
    const [recipientIdentity, recipientHold] = await Promise.all([
      transaction.get(adminDb.doc(`${IDENTITIES}/${toCourierId}`)),
      transaction.get(adminDb.doc(`${HOLDS}/${toCourierId}`)),
    ]);
    if (!courierVehicleDocumentEligibility(
      recipientIdentity.data() as Record<string, unknown> | undefined, targetVehicle
    ).eligible || recipientHold.data()?.active === true) {
      throw new Error('CUSTODY_TRANSFER_CONFLICT');
    }
    const at = Timestamp.now();
    transaction.update(transferRef, {
      status: 'evidence_recorded_pending_reconciliation',
      supervisorConfirmedBy: supervisorId,
      supervisorConfirmedAt: at,
      supervisorNote: note,
      updatedAt: at,
    });
    transaction.update(incidentRef, {
      status: 'transfer_evidence_confirmed_pending_reconciliation',
      supervisedTransferStatus: 'evidence_recorded_pending_reconciliation',
      updatedAt: at,
    });
    transaction.create(eventRef, {
      schemaVersion: 1, deliveryId: id, actorId: supervisorId,
      actorRole: 'supervisor', action: 'evidence_attested',
      fromCourierId, toCourierId, note, createdAt: at,
    });
    // Do not change the original claim, tracking, buyer-confirmation evidence
    // or payables: compensation and recipient GPS have not been reconciled.
    return { deliveryId: id, status: 'evidence_recorded_pending_reconciliation' };
  });
};
