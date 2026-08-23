export type KyrubImportSource = 'manual' | 'mercado_livre' | 'shopee' | 'ifood' | '99food' | 'instagram' | 'erp' | 'csv' | 'ai' | 'other';

export type KyrubSyncAuthority = 'external_to_kyrub' | 'kyrub_to_external' | 'bidirectional' | 'manual';

export interface KyrubImportProvenance {
  storeId: string;
  connectionId?: string;
  source: KyrubImportSource;
  externalId?: string;
  importedAt: string;
  lastSyncedAt?: string;
}

export interface KyrubSyncPolicy {
  storeId: string;
  connectionId: string;
  authority: KyrubSyncAuthority;
  conflictPolicy: 'external_wins' | 'kyrub_wins' | 'manual_review';
  enabled: boolean;
}

const required = (value: string | undefined, code: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
};

export const assertImportProvenance = (value: KyrubImportProvenance): KyrubImportProvenance => {
  required(value.storeId, 'PROVENANCE_STORE_REQUIRED');
  required(value.importedAt, 'PROVENANCE_IMPORTED_AT_REQUIRED');
  if (value.source !== 'manual' && value.source !== 'csv' && value.source !== 'ai') {
    required(value.connectionId, 'PROVENANCE_CONNECTION_REQUIRED');
    required(value.externalId, 'PROVENANCE_EXTERNAL_ID_REQUIRED');
  }
  return value;
};

export const assertSyncPolicy = (value: KyrubSyncPolicy): KyrubSyncPolicy => {
  required(value.storeId, 'SYNC_STORE_REQUIRED');
  required(value.connectionId, 'SYNC_CONNECTION_REQUIRED');
  if (value.authority === 'bidirectional' && value.conflictPolicy !== 'manual_review') {
    throw new Error('BIDIRECTIONAL_SYNC_REQUIRES_MANUAL_REVIEW');
  }
  return value;
};

export const assertSameTenant = (expectedStoreId: string, actualStoreId: string, resource: string): void => {
  if (!expectedStoreId.trim() || !actualStoreId.trim() || expectedStoreId !== actualStoreId) {
    throw new Error(`TENANT_ISOLATION_VIOLATION:${resource}`);
  }
};

export const assertImportAuthority = (
  storeId: string,
  provenance: KyrubImportProvenance,
  policy?: KyrubSyncPolicy
): void => {
  assertSameTenant(storeId, provenance.storeId, 'provenance');
  if (policy) {
    assertSameTenant(storeId, policy.storeId, 'sync_policy');
    if (provenance.connectionId && policy.connectionId !== provenance.connectionId) {
      throw new Error('CONNECTION_AUTHORITY_MISMATCH');
    }
  }
};
