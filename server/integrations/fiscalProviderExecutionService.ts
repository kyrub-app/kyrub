import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import type {
  FiscalHomologationAttempt,
  FiscalHomologationAttemptState,
} from '../../shared/fiscalHomologationAttempt.js';
import { assertFiscalHomologationAttemptStateTransition } from '../../shared/fiscalHomologationAttempt.js';
import {
  createRuntimeFiscalProviderAdapterRegistry,
  type FiscalProviderAdapter,
  type FiscalProviderAdapterRegistry,
  type FiscalProviderOutcome,
  type FiscalProviderProtectedContext,
} from './fiscalProviderAdapter.js';
import {
  loadFiscalProviderExecutionConfiguration,
  type FiscalProviderExecutionConfiguration,
} from './fiscalProviderConfigurationRegistry.js';
import { createKyrubCredentialVault } from './kyrubCredentialVault.js';
import { resolveFiscalHomologationOwnerAuthority } from './fiscalHomologationAttemptLedger.js';

const ATTEMPT_ID_PATTERN = /^fiscal-attempt-[a-f0-9]{48}$/;
const SAFE_TEXT_MAX = 500;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const attemptPath = (canonicalStoreId: string, attemptId: string): string =>
  `stores/${canonicalStoreId}/fiscalAttempts/${attemptId}`;

const nowIso = (value: Date): string => value.toISOString();

const parseAttempt = (
  value: unknown,
  expected: { canonicalStoreId: string; attemptId: string; actorUserId: string }
): FiscalHomologationAttempt => {
  const stored = record(value);
  const policy = record(stored.policy);
  const actor = record(stored.actor);
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.attemptId, 160) !== expected.attemptId ||
    clean(stored.evidenceFingerprint, 80).length !== 64 ||
    clean(stored.canonicalStoreId, 160) !== expected.canonicalStoreId ||
    !clean(stored.orderId, 240) ||
    stored.environment !== 'sandbox' ||
    policy.environment !== 'sandbox' ||
    !['nfe', 'nfce', 'nfse'].includes(String(policy.documentFamily ?? '')) ||
    clean(actor.userId, 160) !== expected.actorUserId ||
    actor.resolvedRole !== 'owner' ||
    actor.requiredPermission !== 'fiscal.homologation.emit' ||
    actor.authorizationMode !== 'canonical_store_owner_fallback' ||
    stored.authority !== 'kyrub_fiscal_homologation_attempt_ledger'
  ) {
    throw new Error('FISCAL_ATTEMPT_STORED_RECORD_INVALID');
  }
  return stored as unknown as FiscalHomologationAttempt;
};

const assertAdapterCompatibility = (
  adapter: FiscalProviderAdapter,
  configuration: FiscalProviderExecutionConfiguration,
  attempt: FiscalHomologationAttempt
): void => {
  if (
    attempt.environment !== 'sandbox' ||
    configuration.environment !== 'sandbox' ||
    configuration.documentFamily !== attempt.policy.documentFamily ||
    !adapter.supportedEnvironments.includes('sandbox') ||
    !adapter.supportedDocumentFamilies.includes(attempt.policy.documentFamily)
  ) {
    throw new Error('FISCAL_PROVIDER_CONFIGURATION_UNSUPPORTED');
  }
};

const protectedContextFor = (input: {
  configuration: FiscalProviderExecutionConfiguration;
  credential: string;
  credentialVersion: string;
}): FiscalProviderProtectedContext => ({
  credential: input.credential,
  credentialVersion: input.credentialVersion,
  configuration: {
    adapterId: input.configuration.adapterId,
    adapterVersion: input.configuration.adapterVersion,
    documentFamily: input.configuration.documentFamily,
    environment: 'sandbox',
  },
});

export type FiscalProviderAttemptPatch = Pick<
  FiscalHomologationAttempt,
  | 'state'
  | 'externalRequestId'
  | 'providerStatus'
  | 'providerCode'
  | 'providerMessage'
  | 'authorizationProtocol'
  | 'accessKey'
  | 'documentNumber'
>;

export const fiscalProviderOutcomePatch = (input: {
  currentState: FiscalHomologationAttemptState;
  outcome: FiscalProviderOutcome;
  reconciliation: boolean;
}): FiscalProviderAttemptPatch => {
  const safeMessage = (value: string | null | undefined): string | null => {
    const normalized = clean(value, SAFE_TEXT_MAX);
    return normalized || null;
  };
  const externalRequestId = 'externalRequestId' in input.outcome
    ? safeMessage(input.outcome.externalRequestId)
    : null;
  const providerStatus = safeMessage(input.outcome.providerStatus);

  if (input.outcome.kind === 'authorized') {
    assertFiscalHomologationAttemptStateTransition(input.currentState, 'authorized');
    return {
      state: 'authorized',
      externalRequestId,
      providerStatus,
      providerCode: null,
      providerMessage: null,
      authorizationProtocol: safeMessage(input.outcome.authorizationProtocol),
      accessKey: safeMessage(input.outcome.accessKey),
      documentNumber: safeMessage(input.outcome.documentNumber),
    };
  }

  if (input.outcome.kind === 'rejected' || input.outcome.kind === 'validation_failure') {
    assertFiscalHomologationAttemptStateTransition(input.currentState, 'rejected');
    return {
      state: 'rejected',
      externalRequestId,
      providerStatus,
      providerCode: safeMessage(input.outcome.code),
      providerMessage: safeMessage(input.outcome.safeMessage),
      authorizationProtocol: null,
      accessKey: null,
      documentNumber: null,
    };
  }

  if (input.outcome.kind === 'processing') {
    // A status read that is still pending must never convert a
    // reconciliation-required attempt back into a submit-eligible state.
    return {
      state: input.reconciliation && input.currentState === 'reconciliation_required'
        ? 'reconciliation_required'
        : input.currentState,
      externalRequestId,
      providerStatus,
      providerCode: null,
      providerMessage: null,
      authorizationProtocol: null,
      accessKey: null,
      documentNumber: null,
    };
  }

  if (input.currentState !== 'reconciliation_required') {
    assertFiscalHomologationAttemptStateTransition(
      input.currentState,
      'reconciliation_required'
    );
  }
  return {
    state: 'reconciliation_required',
    externalRequestId,
    providerStatus,
    providerCode: null,
    providerMessage: safeMessage(input.outcome.safeMessage),
    authorizationProtocol: null,
    accessKey: null,
    documentNumber: null,
  };
};

const loadProtectedAdapterContext = async (input: {
  canonicalStoreId: string;
  attempt: FiscalHomologationAttempt;
  registry: FiscalProviderAdapterRegistry;
}): Promise<{
  adapter: FiscalProviderAdapter;
  configuration: FiscalProviderExecutionConfiguration;
  protectedContext: FiscalProviderProtectedContext;
}> => {
  const configuration = await loadFiscalProviderExecutionConfiguration({
    canonicalStoreId: input.canonicalStoreId,
    documentFamily: input.attempt.policy.documentFamily,
  });
  const adapter = input.registry.get(
    configuration.adapterId,
    configuration.adapterVersion
  );
  assertAdapterCompatibility(adapter, configuration, input.attempt);

  const vault = createKyrubCredentialVault();
  const credential = await vault.readLatest(configuration.credentialSecretRef);
  if (!credential.value.trim()) throw new Error('FISCAL_PROVIDER_CREDENTIAL_INVALID');

  return {
    adapter,
    configuration,
    protectedContext: protectedContextFor({
      configuration,
      credential: credential.value,
      credentialVersion: credential.version,
    }),
  };
};

const persistProviderOutcome = async (input: {
  canonicalStoreId: string;
  attemptId: string;
  actorUserId: string;
  expectedAdapterId: string;
  expectedAdapterVersion: string;
  allowedStates: readonly FiscalHomologationAttemptState[];
  patch: FiscalProviderAttemptPatch;
  checkedAt: string;
}): Promise<FiscalHomologationAttempt> => {
  const ref = adminDb.doc(attemptPath(input.canonicalStoreId, input.attemptId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('FISCAL_ATTEMPT_NOT_FOUND');
    const current = parseAttempt(snapshot.data(), {
      canonicalStoreId: input.canonicalStoreId,
      attemptId: input.attemptId,
      actorUserId: input.actorUserId,
    });
    if (
      !input.allowedStates.includes(current.state) ||
      current.providerAdapterId !== input.expectedAdapterId ||
      current.providerAdapterVersion !== input.expectedAdapterVersion
    ) {
      throw new Error('FISCAL_ATTEMPT_EXECUTION_STALE');
    }

    const next: FiscalHomologationAttempt = {
      ...current,
      ...input.patch,
      lastCheckedAt: input.checkedAt,
      updatedAt: input.checkedAt,
    };
    transaction.update(ref, {
      ...input.patch,
      lastCheckedAt: input.checkedAt,
      updatedAt: input.checkedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });
};

export interface FiscalProviderExecutionResult {
  schemaVersion: 1;
  attempt: FiscalHomologationAttempt;
  authority: 'server_fiscal_provider_executor';
}

export const executePreparedFiscalHomologationAttempt = async (input: {
  tenantId: string;
  requestedByUserId: string;
  attemptId: string;
  now?: Date;
  registry?: FiscalProviderAdapterRegistry;
}): Promise<FiscalProviderExecutionResult> => {
  const attemptId = clean(input.attemptId, 160);
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new Error('FISCAL_ATTEMPT_ID_INVALID');
  }
  const canonicalStoreId = await resolveFiscalHomologationOwnerAuthority(input);
  const ref = adminDb.doc(attemptPath(canonicalStoreId, attemptId));
  const initialSnapshot = await ref.get();
  if (!initialSnapshot.exists) throw new Error('FISCAL_ATTEMPT_NOT_FOUND');
  const initialAttempt = parseAttempt(initialSnapshot.data(), {
    canonicalStoreId,
    attemptId,
    actorUserId: input.requestedByUserId,
  });
  if (initialAttempt.state !== 'prepared') {
    throw new Error('FISCAL_ATTEMPT_NOT_PREPARED');
  }

  // Fail closed before claiming the attempt if provider configuration, adapter
  // or protected credentials are missing. This avoids stranding the attempt in
  // processing when no external request could even be attempted.
  const registry = input.registry ?? createRuntimeFiscalProviderAdapterRegistry();
  const context = await loadProtectedAdapterContext({
    canonicalStoreId,
    attempt: initialAttempt,
    registry,
  });
  const submittedAt = nowIso(input.now ?? new Date());

  const claimedAttempt = await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new Error('FISCAL_ATTEMPT_NOT_FOUND');
    const current = parseAttempt(snapshot.data(), {
      canonicalStoreId,
      attemptId,
      actorUserId: input.requestedByUserId,
    });
    if (current.state !== 'prepared') {
      throw new Error('FISCAL_ATTEMPT_ALREADY_CLAIMED');
    }
    assertFiscalHomologationAttemptStateTransition(current.state, 'processing');

    const next: FiscalHomologationAttempt = {
      ...current,
      state: 'processing',
      providerAdapterId: context.adapter.id,
      providerAdapterVersion: context.adapter.version,
      providerStatus: 'submission_claimed',
      submittedAt,
      lastCheckedAt: submittedAt,
      updatedAt: submittedAt,
    };
    transaction.update(ref, {
      state: 'processing',
      providerAdapterId: context.adapter.id,
      providerAdapterVersion: context.adapter.version,
      providerStatus: 'submission_claimed',
      submittedAt,
      lastCheckedAt: submittedAt,
      updatedAt: submittedAt,
      serverUpdatedAt: FieldValue.serverTimestamp(),
    });
    return next;
  });

  let outcome: FiscalProviderOutcome;
  try {
    outcome = await context.adapter.submit({
      attempt: claimedAttempt,
      protectedContext: context.protectedContext,
    });
  } catch {
    // Once submit has been invoked, an unclassified throw is ambiguous: the
    // provider may have received the document. Never blindly submit again.
    outcome = {
      kind: 'technical_ambiguity',
      externalRequestId: null,
      providerStatus: 'submission_outcome_unknown',
      safeMessage: 'O resultado do envio ao provedor precisa ser reconciliado antes de qualquer nova ação.',
    };
  }

  const checkedAt = nowIso(input.now ?? new Date());
  const patch = fiscalProviderOutcomePatch({
    currentState: 'processing',
    outcome,
    reconciliation: false,
  });
  const attempt = await persistProviderOutcome({
    canonicalStoreId,
    attemptId,
    actorUserId: input.requestedByUserId,
    expectedAdapterId: context.adapter.id,
    expectedAdapterVersion: context.adapter.version,
    allowedStates: ['processing'],
    patch,
    checkedAt,
  });
  return { schemaVersion: 1, attempt, authority: 'server_fiscal_provider_executor' };
};

export const reconcileFiscalHomologationAttempt = async (input: {
  tenantId: string;
  requestedByUserId: string;
  attemptId: string;
  now?: Date;
  registry?: FiscalProviderAdapterRegistry;
}): Promise<FiscalProviderExecutionResult> => {
  const attemptId = clean(input.attemptId, 160);
  if (!ATTEMPT_ID_PATTERN.test(attemptId)) {
    throw new Error('FISCAL_ATTEMPT_ID_INVALID');
  }
  const canonicalStoreId = await resolveFiscalHomologationOwnerAuthority(input);
  const ref = adminDb.doc(attemptPath(canonicalStoreId, attemptId));
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error('FISCAL_ATTEMPT_NOT_FOUND');
  const current = parseAttempt(snapshot.data(), {
    canonicalStoreId,
    attemptId,
    actorUserId: input.requestedByUserId,
  });
  if (
    current.state !== 'processing' &&
    current.state !== 'reconciliation_required'
  ) {
    throw new Error('FISCAL_ATTEMPT_RECONCILIATION_NOT_ALLOWED');
  }
  if (!current.providerAdapterId || !current.providerAdapterVersion) {
    throw new Error('FISCAL_ATTEMPT_PROVIDER_BINDING_REQUIRED');
  }

  const registry = input.registry ?? createRuntimeFiscalProviderAdapterRegistry();
  const context = await loadProtectedAdapterContext({
    canonicalStoreId,
    attempt: current,
    registry,
  });
  if (
    context.adapter.id !== current.providerAdapterId ||
    context.adapter.version !== current.providerAdapterVersion
  ) {
    throw new Error('FISCAL_ATTEMPT_PROVIDER_BINDING_MISMATCH');
  }

  let outcome: FiscalProviderOutcome;
  try {
    // Reconciliation is read/status only. It never calls submit again.
    outcome = await context.adapter.getStatus({
      attempt: current,
      externalRequestId: current.externalRequestId,
      protectedContext: context.protectedContext,
    });
  } catch {
    outcome = {
      kind: 'technical_ambiguity',
      externalRequestId: current.externalRequestId,
      providerStatus: 'status_check_failed',
      safeMessage: 'O status do provedor ainda não pôde ser confirmado.',
    };
  }

  const checkedAt = nowIso(input.now ?? new Date());
  const patch = fiscalProviderOutcomePatch({
    currentState: current.state,
    outcome,
    reconciliation: true,
  });
  const attempt = await persistProviderOutcome({
    canonicalStoreId,
    attemptId,
    actorUserId: input.requestedByUserId,
    expectedAdapterId: current.providerAdapterId,
    expectedAdapterVersion: current.providerAdapterVersion,
    allowedStates: ['processing', 'reconciliation_required'],
    patch,
    checkedAt,
  });
  return { schemaVersion: 1, attempt, authority: 'server_fiscal_provider_executor' };
};
