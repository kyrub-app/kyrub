import type { FiscalHomologationDocumentFamily } from '../../shared/fiscalHomologationPolicy.js';
import type { FiscalHomologationAttempt } from '../../shared/fiscalHomologationAttempt.js';
import type { FiscalProviderExecutionEvidence } from './fiscalProviderExecutionEvidence.js';
import { buildFocusNfcePayload } from './focusNfcePayloadBuilder.js';
import {
  buildFocusNfeReference,
  getFocusNfeSandboxDocumentStatus,
  submitFocusNfeSandboxDocument,
} from './focusNfeSandboxTransport.js';

export type FiscalProviderOutcome =
  | {
      kind: 'authorized';
      externalRequestId: string;
      providerStatus: string;
      authorizationProtocol: string | null;
      accessKey: string | null;
      documentNumber: string | null;
    }
  | {
      kind: 'rejected';
      externalRequestId: string | null;
      providerStatus: string;
      code: string | null;
      safeMessage: string;
    }
  | {
      kind: 'processing';
      externalRequestId: string;
      providerStatus: string;
    }
  | {
      kind: 'validation_failure';
      providerStatus: string;
      code: string | null;
      safeMessage: string;
    }
  | {
      kind: 'technical_ambiguity';
      externalRequestId: string | null;
      providerStatus: string;
      safeMessage: string;
    };

export interface FiscalProviderProtectedContext {
  credential: string;
  credentialVersion: string;
  configuration: {
    adapterId: string;
    adapterVersion: string;
    documentFamily: FiscalHomologationDocumentFamily;
    environment: 'sandbox';
  };
}

export interface FiscalProviderPreparedSubmission {
  externalRequestId: string;
  payloadFingerprint: string;
  payload: Record<string, unknown>;
}

export interface FiscalProviderAdapter {
  id: string;
  version: string;
  supportedDocumentFamilies: readonly FiscalHomologationDocumentFamily[];
  supportedEnvironments: readonly ['sandbox'];
  prepareSubmission(input: {
    attempt: FiscalHomologationAttempt;
    evidence: FiscalProviderExecutionEvidence;
    submissionAt: Date;
  }): Promise<FiscalProviderPreparedSubmission> | FiscalProviderPreparedSubmission;
  submit(input: {
    attempt: FiscalHomologationAttempt;
    preparedSubmission: FiscalProviderPreparedSubmission;
    protectedContext: FiscalProviderProtectedContext;
  }): Promise<FiscalProviderOutcome>;
  getStatus(input: {
    attempt: FiscalHomologationAttempt;
    externalRequestId: string | null;
    protectedContext: FiscalProviderProtectedContext;
  }): Promise<FiscalProviderOutcome>;
}

const adapterKey = (id: string, version: string): string => `${id.trim()}@${version.trim()}`;

export interface FiscalProviderAdapterRegistry {
  get(id: string, version: string): FiscalProviderAdapter;
}

export const buildFiscalProviderAdapterRegistry = (
  adapters: readonly FiscalProviderAdapter[]
): FiscalProviderAdapterRegistry => {
  const byKey = new Map<string, FiscalProviderAdapter>();
  for (const adapter of adapters) {
    const id = adapter.id.trim();
    const version = adapter.version.trim();
    if (!id || !version || adapter.supportedEnvironments.length !== 1 || adapter.supportedEnvironments[0] !== 'sandbox') {
      throw new Error('FISCAL_PROVIDER_ADAPTER_INVALID');
    }
    const key = adapterKey(id, version);
    if (byKey.has(key)) throw new Error('FISCAL_PROVIDER_ADAPTER_DUPLICATE');
    byKey.set(key, adapter);
  }

  return {
    get(id: string, version: string): FiscalProviderAdapter {
      const adapter = byKey.get(adapterKey(id, version));
      if (!adapter) throw new Error('FISCAL_PROVIDER_ADAPTER_UNAVAILABLE');
      return adapter;
    },
  };
};

export const focusNfceSandboxAdapter: FiscalProviderAdapter = {
  id: 'focus-nfe',
  version: '1',
  supportedDocumentFamilies: ['nfce'],
  supportedEnvironments: ['sandbox'],

  prepareSubmission({ attempt, evidence, submissionAt }) {
    if (
      attempt.policy.documentFamily !== 'nfce' ||
      evidence.snapshot.documentFamily !== 'nfce'
    ) {
      throw new Error('FOCUS_NFCE_DOCUMENT_FAMILY_UNSUPPORTED');
    }
    const prepared = buildFocusNfcePayload({ evidence, emissionAt: submissionAt });
    return {
      externalRequestId: buildFocusNfeReference(attempt.attemptId),
      payloadFingerprint: prepared.payloadFingerprint,
      payload: prepared.payload,
    };
  },

  async submit({ attempt, preparedSubmission, protectedContext }) {
    const expectedReference = buildFocusNfeReference(attempt.attemptId);
    if (
      protectedContext.configuration.adapterId !== 'focus-nfe' ||
      protectedContext.configuration.adapterVersion !== '1' ||
      protectedContext.configuration.documentFamily !== 'nfce' ||
      preparedSubmission.externalRequestId !== expectedReference ||
      !/^[a-f0-9]{64}$/.test(preparedSubmission.payloadFingerprint)
    ) {
      throw new Error('FOCUS_NFCE_PREPARED_SUBMISSION_INVALID');
    }
    return submitFocusNfeSandboxDocument({
      family: 'nfce',
      attemptId: attempt.attemptId,
      token: protectedContext.credential,
      payload: preparedSubmission.payload,
    });
  },

  async getStatus({ attempt, externalRequestId, protectedContext }) {
    const expectedReference = buildFocusNfeReference(attempt.attemptId);
    if (
      protectedContext.configuration.adapterId !== 'focus-nfe' ||
      protectedContext.configuration.adapterVersion !== '1' ||
      protectedContext.configuration.documentFamily !== 'nfce' ||
      (externalRequestId !== null && externalRequestId !== expectedReference)
    ) {
      throw new Error('FOCUS_NFCE_RECONCILIATION_BINDING_INVALID');
    }
    return getFocusNfeSandboxDocumentStatus({
      family: 'nfce',
      attemptId: attempt.attemptId,
      token: protectedContext.credential,
    });
  },
};

// The first concrete runtime provider is intentionally limited to NFC-e in
// sandbox. NF-e/NFS-e remain unavailable until their payload builders are
// separately verified and registered.
export const createRuntimeFiscalProviderAdapterRegistry = (): FiscalProviderAdapterRegistry =>
  buildFiscalProviderAdapterRegistry([focusNfceSandboxAdapter]);
