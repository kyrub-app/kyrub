import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type { FiscalProductionExecutionClaim } from './fiscalProductionExecutorFoundation.js';
import type { FiscalProductionOutcomePatch } from './fiscalProductionOutcome.js';

export type FiscalProductionAttemptState =
  | 'prepared'
  | 'processing'
  | 'authorized'
  | 'rejected'
  | 'reconciliation_required';

export interface FiscalProductionAttemptRecord {
  schemaVersion: 1;
  canonicalStoreId: string;
  attemptId: string;
  state: FiscalProductionAttemptState;
  adapterId: string | null;
  adapterVersion: string | null;
  credentialVersion: string | null;
  externalRequestId: string | null;
  payloadFingerprint: string | null;
  claimedAt: string | null;
  lastCheckedAt: string | null;
  providerStatus?: string | null;
  providerCode?: string | null;
  providerMessage?: string | null;
  authorizationProtocol?: string | null;
  accessKey?: string | null;
  documentNumber?: string | null;
  authority: 'server_fiscal_production_attempt_ledger';
}

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const pathFor = (canonicalStoreId: string, attemptId: string): string =>
  `stores/${canonicalStoreId}/fiscalProductionAttempts/${attemptId}`;

const parse = (value: unknown, canonicalStoreId: string, attemptId: string): FiscalProductionAttemptRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FISCAL_PRODUCTION_ATTEMPT_STORED_RECORD_INVALID');
  }
  const raw = value as Record<string, unknown>;
  const state = clean(raw.state, 40) as FiscalProductionAttemptState;
  if (
    raw.schemaVersion !== 1 ||
    clean(raw.canonicalStoreId, 160) !== canonicalStoreId ||
    clean(raw.attemptId, 160) !== attemptId ||
    !['prepared', 'processing', 'authorized', 'rejected', 'reconciliation_required'].includes(state) ||
    raw.authority !== 'server_fiscal_production_attempt_ledger'
  ) {
    throw new Error('FISCAL_PRODUCTION_ATTEMPT_STORED_RECORD_INVALID');
  }
  return raw as unknown as FiscalProductionAttemptRecord;
};

/** Atomically claims a prepared production attempt exactly once. */
export const claimFiscalProductionAttempt = async (input: {
  claim: FiscalProductionExecutionClaim;
}): Promise<FiscalProductionAttemptRecord> => {
  const { claim } = input;
  const ref = adminDb.doc(pathFor(claim.canonicalStoreId, claim.attemptId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('FISCAL_PRODUCTION_ATTEMPT_NOT_FOUND');
    const current = parse(snapshot.data(), claim.canonicalStoreId, claim.attemptId);
    if (current.state !== 'prepared') {
      throw new Error('FISCAL_PRODUCTION_ATTEMPT_ALREADY_CLAIMED');
    }
    if (
      current.adapterId !== null ||
      current.adapterVersion !== null ||
      current.credentialVersion !== null ||
      current.externalRequestId !== null ||
      current.payloadFingerprint !== null ||
      current.claimedAt !== null
    ) {
      throw new Error('FISCAL_PRODUCTION_ATTEMPT_EXECUTION_STALE');
    }

    const next: FiscalProductionAttemptRecord = {
      ...current,
      state: 'processing',
      adapterId: claim.adapterId,
      adapterVersion: claim.adapterVersion,
      credentialVersion: claim.credentialVersion,
      externalRequestId: claim.externalRequestId,
      payloadFingerprint: claim.payloadFingerprint,
      claimedAt: claim.claimedAt,
      lastCheckedAt: claim.claimedAt,
    };
    transaction.update(ref, {
      state: next.state,
      adapterId: next.adapterId,
      adapterVersion: next.adapterVersion,
      credentialVersion: next.credentialVersion,
      externalRequestId: next.externalRequestId,
      payloadFingerprint: next.payloadFingerprint,
      claimedAt: next.claimedAt,
      lastCheckedAt: next.lastCheckedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
};

/**
 * Marks an unknown provider outcome for reconciliation without permitting a
 * second submission or manufacturing an authorization state.
 */
export const requireFiscalProductionReconciliation = async (input: {
  canonicalStoreId: string;
  attemptId: string;
  expectedExternalRequestId: string;
  expectedPayloadFingerprint: string;
  checkedAt: string;
}): Promise<FiscalProductionAttemptRecord> => {
  const ref = adminDb.doc(pathFor(input.canonicalStoreId, input.attemptId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('FISCAL_PRODUCTION_ATTEMPT_NOT_FOUND');
    const current = parse(snapshot.data(), input.canonicalStoreId, input.attemptId);
    if (
      !['processing', 'reconciliation_required'].includes(current.state) ||
      current.externalRequestId !== input.expectedExternalRequestId ||
      current.payloadFingerprint !== input.expectedPayloadFingerprint
    ) {
      throw new Error('FISCAL_PRODUCTION_ATTEMPT_RECONCILIATION_STALE');
    }

    const next: FiscalProductionAttemptRecord = {
      ...current,
      state: 'reconciliation_required',
      lastCheckedAt: input.checkedAt,
    };
    transaction.update(ref, {
      state: 'reconciliation_required',
      lastCheckedAt: input.checkedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
};

/** Persists one provider outcome only while the frozen submission binding matches. */
export const persistFiscalProductionOutcome = async (input: {
  canonicalStoreId: string;
  attemptId: string;
  expectedExternalRequestId: string;
  expectedPayloadFingerprint: string;
  checkedAt: string;
  patch: FiscalProductionOutcomePatch;
}): Promise<FiscalProductionAttemptRecord> => {
  const ref = adminDb.doc(pathFor(input.canonicalStoreId, input.attemptId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('FISCAL_PRODUCTION_ATTEMPT_NOT_FOUND');
    const current = parse(snapshot.data(), input.canonicalStoreId, input.attemptId);
    if (current.state === 'authorized' || current.state === 'rejected') {
      throw new Error('FISCAL_PRODUCTION_ATTEMPT_TERMINAL');
    }
    if (
      !['processing', 'reconciliation_required'].includes(current.state) ||
      current.externalRequestId !== input.expectedExternalRequestId ||
      current.payloadFingerprint !== input.expectedPayloadFingerprint
    ) {
      throw new Error('FISCAL_PRODUCTION_OUTCOME_BINDING_STALE');
    }
    if (!['processing', 'authorized', 'rejected', 'reconciliation_required'].includes(input.patch.state)) {
      throw new Error('FISCAL_PRODUCTION_OUTCOME_STATE_INVALID');
    }

    const next: FiscalProductionAttemptRecord = {
      ...current,
      ...input.patch,
      lastCheckedAt: input.checkedAt,
    };
    transaction.update(ref, {
      state: next.state,
      providerStatus: next.providerStatus ?? null,
      providerCode: next.providerCode ?? null,
      providerMessage: next.providerMessage ?? null,
      authorizationProtocol: next.authorizationProtocol ?? null,
      accessKey: next.accessKey ?? null,
      documentNumber: next.documentNumber ?? null,
      lastCheckedAt: next.lastCheckedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
};
