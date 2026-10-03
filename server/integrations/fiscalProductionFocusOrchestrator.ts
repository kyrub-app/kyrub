import type { FiscalProductionAttemptRecord } from './fiscalProductionAttemptLedger.js';
import {
  persistFiscalProductionOutcome,
  requireFiscalProductionReconciliation,
} from './fiscalProductionAttemptLedger.js';
import { fiscalProductionOutcomePatch } from './fiscalProductionOutcome.js';
import {
  getFocusNfceProductionDocumentStatus,
  submitFocusNfceProductionDocument,
  type FocusNfceProductionCapability,
} from './focusNfceProductionTransport.js';
import { buildFocusNfeReference } from './focusNfeSandboxTransport.js';

export interface FiscalProductionFocusOrchestratorDependencies {
  persistOutcome?: typeof persistFiscalProductionOutcome;
  requireReconciliation?: typeof requireFiscalProductionReconciliation;
}

type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Pick<Response, 'status' | 'json'>>;

const assertFrozenFocusBinding = (attempt: FiscalProductionAttemptRecord): {
  externalRequestId: string;
  payloadFingerprint: string;
} => {
  if (!['processing', 'reconciliation_required'].includes(attempt.state)) {
    throw new Error('FISCAL_PRODUCTION_FOCUS_ATTEMPT_STATE_INVALID');
  }
  const expectedReference = buildFocusNfeReference(attempt.attemptId);
  if (attempt.externalRequestId !== expectedReference || !attempt.payloadFingerprint) {
    throw new Error('FISCAL_PRODUCTION_FOCUS_BINDING_INVALID');
  }
  return {
    externalRequestId: attempt.externalRequestId,
    payloadFingerprint: attempt.payloadFingerprint,
  };
};

/**
 * Internal composition boundary for Kyrub Fiscal -> Focus -> ledger.
 * It is deliberately non-routable and still requires the server-owned
 * production capability enforced by the transport itself.
 */
export const executeFocusNfceProductionAttempt = async (input: {
  attempt: FiscalProductionAttemptRecord;
  token: string;
  payload: Record<string, unknown>;
  capability?: FocusNfceProductionCapability | null;
  checkedAt: string;
  fetchImpl?: FetchLike;
  dependencies?: FiscalProductionFocusOrchestratorDependencies;
}): Promise<FiscalProductionAttemptRecord> => {
  const binding = assertFrozenFocusBinding(input.attempt);
  const persistOutcome = input.dependencies?.persistOutcome ?? persistFiscalProductionOutcome;
  const requireReconciliation = input.dependencies?.requireReconciliation ?? requireFiscalProductionReconciliation;

  try {
    const outcome = await submitFocusNfceProductionDocument({
      canonicalStoreId: input.attempt.canonicalStoreId,
      attemptId: input.attempt.attemptId,
      token: input.token,
      payload: input.payload,
      capability: input.capability,
      fetchImpl: input.fetchImpl,
    });
    const patch = fiscalProductionOutcomePatch({
      currentState: input.attempt.state,
      outcome,
      reconciliation: false,
    });
    return persistOutcome({
      canonicalStoreId: input.attempt.canonicalStoreId,
      attemptId: input.attempt.attemptId,
      expectedExternalRequestId: binding.externalRequestId,
      expectedPayloadFingerprint: binding.payloadFingerprint,
      checkedAt: input.checkedAt,
      patch,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'FOCUS_NFCE_PRODUCTION_CAPABILITY_REQUIRED') {
      throw error;
    }
    await requireReconciliation({
      canonicalStoreId: input.attempt.canonicalStoreId,
      attemptId: input.attempt.attemptId,
      expectedExternalRequestId: binding.externalRequestId,
      expectedPayloadFingerprint: binding.payloadFingerprint,
      checkedAt: input.checkedAt,
    });
    throw error;
  }
};

/** Reconciles an already claimed attempt by GET only; it never resubmits. */
export const reconcileFocusNfceProductionAttempt = async (input: {
  attempt: FiscalProductionAttemptRecord;
  token: string;
  capability?: FocusNfceProductionCapability | null;
  checkedAt: string;
  fetchImpl?: FetchLike;
  dependencies?: FiscalProductionFocusOrchestratorDependencies;
}): Promise<FiscalProductionAttemptRecord> => {
  const binding = assertFrozenFocusBinding(input.attempt);
  const persistOutcome = input.dependencies?.persistOutcome ?? persistFiscalProductionOutcome;
  const requireReconciliation = input.dependencies?.requireReconciliation ?? requireFiscalProductionReconciliation;

  try {
    const outcome = await getFocusNfceProductionDocumentStatus({
      canonicalStoreId: input.attempt.canonicalStoreId,
      attemptId: input.attempt.attemptId,
      token: input.token,
      capability: input.capability,
      fetchImpl: input.fetchImpl,
    });
    const patch = fiscalProductionOutcomePatch({
      currentState: input.attempt.state,
      outcome,
      reconciliation: true,
    });
    return persistOutcome({
      canonicalStoreId: input.attempt.canonicalStoreId,
      attemptId: input.attempt.attemptId,
      expectedExternalRequestId: binding.externalRequestId,
      expectedPayloadFingerprint: binding.payloadFingerprint,
      checkedAt: input.checkedAt,
      patch,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'FOCUS_NFCE_PRODUCTION_CAPABILITY_REQUIRED') {
      throw error;
    }
    await requireReconciliation({
      canonicalStoreId: input.attempt.canonicalStoreId,
      attemptId: input.attempt.attemptId,
      expectedExternalRequestId: binding.externalRequestId,
      expectedPayloadFingerprint: binding.payloadFingerprint,
      checkedAt: input.checkedAt,
    });
    throw error;
  }
};
