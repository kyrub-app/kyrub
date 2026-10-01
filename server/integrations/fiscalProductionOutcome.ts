import type { FiscalProviderOutcome } from './fiscalProviderAdapter.js';
import type { FiscalProductionAttemptState } from './fiscalProductionAttemptLedger.js';

export interface FiscalProductionOutcomePatch {
  state: FiscalProductionAttemptState;
  providerStatus: string | null;
  providerCode: string | null;
  providerMessage: string | null;
  authorizationProtocol: string | null;
  accessKey: string | null;
  documentNumber: string | null;
}

const clean = (value: unknown, maxLength = 500): string | null => {
  const normalized = typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  return normalized || null;
};

/** Maps provider evidence to production state without inferring authorization. */
export const fiscalProductionOutcomePatch = (input: {
  currentState: FiscalProductionAttemptState;
  outcome: FiscalProviderOutcome;
  reconciliation: boolean;
}): FiscalProductionOutcomePatch => {
  const providerStatus = clean(input.outcome.providerStatus);

  if (input.outcome.kind === 'authorized') {
    if (!['processing', 'reconciliation_required'].includes(input.currentState)) {
      throw new Error('FISCAL_PRODUCTION_AUTHORIZATION_STATE_INVALID');
    }
    const authorizationProtocol = clean(input.outcome.authorizationProtocol);
    const accessKey = clean(input.outcome.accessKey);
    if (!authorizationProtocol || !accessKey) {
      throw new Error('FISCAL_PRODUCTION_AUTHORIZATION_EVIDENCE_REQUIRED');
    }
    return {
      state: 'authorized',
      providerStatus,
      providerCode: null,
      providerMessage: null,
      authorizationProtocol,
      accessKey,
      documentNumber: clean(input.outcome.documentNumber),
    };
  }

  if (input.outcome.kind === 'rejected' || input.outcome.kind === 'validation_failure') {
    if (!['processing', 'reconciliation_required'].includes(input.currentState)) {
      throw new Error('FISCAL_PRODUCTION_REJECTION_STATE_INVALID');
    }
    return {
      state: 'rejected',
      providerStatus,
      providerCode: clean(input.outcome.code),
      providerMessage: clean(input.outcome.safeMessage),
      authorizationProtocol: null,
      accessKey: null,
      documentNumber: null,
    };
  }

  if (input.outcome.kind === 'processing') {
    if (!['processing', 'reconciliation_required'].includes(input.currentState)) {
      throw new Error('FISCAL_PRODUCTION_PROCESSING_STATE_INVALID');
    }
    return {
      state: input.reconciliation || input.currentState === 'reconciliation_required'
        ? 'reconciliation_required'
        : 'processing',
      providerStatus,
      providerCode: null,
      providerMessage: null,
      authorizationProtocol: null,
      accessKey: null,
      documentNumber: null,
    };
  }

  if (!['processing', 'reconciliation_required'].includes(input.currentState)) {
    throw new Error('FISCAL_PRODUCTION_AMBIGUITY_STATE_INVALID');
  }
  return {
    state: 'reconciliation_required',
    providerStatus,
    providerCode: null,
    providerMessage: clean(input.outcome.safeMessage),
    authorizationProtocol: null,
    accessKey: null,
    documentNumber: null,
  };
};
