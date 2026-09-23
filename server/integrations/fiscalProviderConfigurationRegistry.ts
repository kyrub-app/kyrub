import { adminDb } from '../firebaseAdmin.js';
import { parseGoogleSecretManagerRef } from './googleSecretManagerVault.js';
import type { FiscalHomologationDocumentFamily } from '../../shared/fiscalHomologationPolicy.js';

const ADAPTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const ADAPTER_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

export interface FiscalProviderExecutionConfiguration {
  schemaVersion: 1;
  canonicalStoreId: string;
  documentFamily: FiscalHomologationDocumentFamily;
  environment: 'sandbox';
  status: 'active';
  adapterId: string;
  adapterVersion: string;
  credentialSecretRef: string;
  authority: 'server_owned_fiscal_provider_configuration';
}

const configurationPath = (
  canonicalStoreId: string,
  documentFamily: FiscalHomologationDocumentFamily
): string => `stores/${canonicalStoreId}/fiscalProviderConfigurations/${documentFamily}`;

export const loadFiscalProviderExecutionConfiguration = async (input: {
  canonicalStoreId: string;
  documentFamily: FiscalHomologationDocumentFamily;
}): Promise<FiscalProviderExecutionConfiguration> => {
  const canonicalStoreId = clean(input.canonicalStoreId, 160);
  if (!canonicalStoreId) throw new Error('FISCAL_PROVIDER_CONFIGURATION_STORE_REQUIRED');

  const snapshot = await adminDb.doc(
    configurationPath(canonicalStoreId, input.documentFamily)
  ).get();
  if (!snapshot.exists) throw new Error('FISCAL_PROVIDER_NOT_CONFIGURED');

  const stored = record(snapshot.data());
  if (stored.status === 'inactive') {
    throw new Error('FISCAL_PROVIDER_CONFIGURATION_INACTIVE');
  }
  const adapterId = clean(stored.adapterId, 80);
  const adapterVersion = clean(stored.adapterVersion, 40);
  const credentialSecretRef = clean(stored.credentialSecretRef, 320);
  if (
    stored.schemaVersion !== 1 ||
    clean(stored.canonicalStoreId, 160) !== canonicalStoreId ||
    stored.documentFamily !== input.documentFamily ||
    stored.environment !== 'sandbox' ||
    stored.status !== 'active' ||
    stored.authority !== 'server_owned_fiscal_provider_configuration' ||
    !ADAPTER_ID_PATTERN.test(adapterId) ||
    !ADAPTER_VERSION_PATTERN.test(adapterVersion) ||
    !credentialSecretRef
  ) {
    throw new Error('FISCAL_PROVIDER_CONFIGURATION_INVALID');
  }

  parseGoogleSecretManagerRef(credentialSecretRef);

  return {
    schemaVersion: 1,
    canonicalStoreId,
    documentFamily: input.documentFamily,
    environment: 'sandbox',
    status: 'active',
    adapterId,
    adapterVersion,
    credentialSecretRef,
    authority: 'server_owned_fiscal_provider_configuration',
  };
};
