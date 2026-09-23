import type { FiscalHomologationDocumentFamily } from '../../shared/fiscalHomologationPolicy.js';
import type { FiscalHomologationAttempt } from '../../shared/fiscalHomologationAttempt.js';

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

export interface FiscalProviderAdapter {
  id: string;
  version: string;
  supportedDocumentFamilies: readonly FiscalHomologationDocumentFamily[];
  supportedEnvironments: readonly ['sandbox'];
  submit(input: {
    attempt: FiscalHomologationAttempt;
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

// No runtime fiscal provider is selected in this phase. A concrete sandbox
// adapter is added only after #771 chooses and verifies the provider.
export const createRuntimeFiscalProviderAdapterRegistry = (): FiscalProviderAdapterRegistry =>
  buildFiscalProviderAdapterRegistry([]);
