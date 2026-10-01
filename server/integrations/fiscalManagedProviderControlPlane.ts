export type ManagedFiscalProviderId = 'focus-nfe';
export type ManagedFiscalDocumentFamily = 'nfce';

export interface ManagedFiscalProviderPlatformConfig {
  schemaVersion: 1;
  providerId: ManagedFiscalProviderId;
  environment: 'production';
  status: 'disabled' | 'ready';
  credentialSecretRef: string;
  authority: 'server_owned_managed_fiscal_provider';
}

export interface ManagedFiscalStoreEnrollment {
  schemaVersion: 1;
  canonicalStoreId: string;
  providerId: ManagedFiscalProviderId;
  documentFamily: ManagedFiscalDocumentFamily;
  environment: 'production';
  status: 'disabled' | 'prepared' | 'production_authorized' | 'suspended';
  authority: 'server_owned_managed_fiscal_store_enrollment';
}

export interface ManagedFiscalProviderReadiness {
  providerId: ManagedFiscalProviderId;
  providerReady: boolean;
  storeReady: boolean;
  productionTrafficAllowed: boolean;
  blockers: string[];
}

const clean = (value: unknown, maxLength = 320): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

/**
 * Control-plane projection for Kyrub Fiscal.
 * This is intentionally provider-management only: it exposes no credential
 * value and cannot create the runtime production capability used by transport.
 */
export const managedFiscalProviderReadiness = (input: {
  canonicalStoreId: string;
  platform: ManagedFiscalProviderPlatformConfig | null | undefined;
  enrollment: ManagedFiscalStoreEnrollment | null | undefined;
}): ManagedFiscalProviderReadiness => {
  const canonicalStoreId = clean(input.canonicalStoreId, 160);
  const blockers: string[] = [];
  const platform = input.platform;
  const enrollment = input.enrollment;

  const providerReady = Boolean(
    platform &&
    platform.schemaVersion === 1 &&
    platform.providerId === 'focus-nfe' &&
    platform.environment === 'production' &&
    platform.status === 'ready' &&
    platform.authority === 'server_owned_managed_fiscal_provider' &&
    clean(platform.credentialSecretRef)
  );
  if (!providerReady) blockers.push('provider_not_ready');

  const storeReady = Boolean(
    enrollment &&
    enrollment.schemaVersion === 1 &&
    clean(enrollment.canonicalStoreId, 160) === canonicalStoreId &&
    enrollment.providerId === 'focus-nfe' &&
    enrollment.documentFamily === 'nfce' &&
    enrollment.environment === 'production' &&
    enrollment.status === 'production_authorized' &&
    enrollment.authority === 'server_owned_managed_fiscal_store_enrollment'
  );
  if (!storeReady) blockers.push('store_not_production_authorized');

  return {
    providerId: 'focus-nfe',
    providerReady,
    storeReady,
    // Deliberately false: the admin projection cannot mint transport authority.
    productionTrafficAllowed: false,
    blockers,
  };
};
