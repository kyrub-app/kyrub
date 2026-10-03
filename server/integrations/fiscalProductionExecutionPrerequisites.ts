import { parseGoogleSecretManagerRef } from './googleSecretManagerVault.js';
import {
  assertFiscalProductionExecutionAuthorized,
  type FiscalProductionAuthorization,
} from './fiscalProductionAuthorization.js';

export interface FiscalProductionProviderConfiguration {
  schemaVersion: 1;
  canonicalStoreId: string;
  documentFamily: 'nfce';
  environment: 'production';
  status: 'active';
  adapterId: string;
  adapterVersion: string;
  credentialSecretRef: string;
  authority: 'server_owned_fiscal_provider_configuration';
}

export interface FiscalProductionCredentialEvidence {
  secretRef: string;
  version: string;
  resourceName: string;
  value: string;
}

export interface FiscalProductionExecutionPrerequisites {
  authorization: FiscalProductionAuthorization;
  configuration: FiscalProductionProviderConfiguration;
  credential: FiscalProductionCredentialEvidence;
}

const clean = (value: unknown, maxLength = 320): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

/**
 * Combines the three independent production barriers without calling a fiscal
 * provider: explicit store authorization, server-owned provider configuration,
 * and a credential read from the exact configured Secret Manager reference.
 */
export const assertFiscalProductionExecutionPrerequisites = (input: {
  canonicalStoreId: string;
  authorization: FiscalProductionAuthorization | null | undefined;
  configuration: FiscalProductionProviderConfiguration | null | undefined;
  credential: FiscalProductionCredentialEvidence | null | undefined;
}): FiscalProductionExecutionPrerequisites => {
  const canonicalStoreId = clean(input.canonicalStoreId, 160);
  const authorization = assertFiscalProductionExecutionAuthorized({
    canonicalStoreId,
    documentFamily: 'nfce',
    authorization: input.authorization,
  });
  const configuration = input.configuration;
  if (!configuration) throw new Error('FISCAL_PRODUCTION_PROVIDER_CONFIGURATION_REQUIRED');

  const adapterId = clean(configuration.adapterId, 80);
  const adapterVersion = clean(configuration.adapterVersion, 40);
  const credentialSecretRef = clean(configuration.credentialSecretRef, 320);
  if (
    configuration.schemaVersion !== 1 ||
    clean(configuration.canonicalStoreId, 160) !== canonicalStoreId ||
    configuration.documentFamily !== 'nfce' ||
    configuration.environment !== 'production' ||
    configuration.status !== 'active' ||
    configuration.authority !== 'server_owned_fiscal_provider_configuration' ||
    !adapterId ||
    !adapterVersion ||
    !credentialSecretRef
  ) {
    throw new Error('FISCAL_PRODUCTION_PROVIDER_CONFIGURATION_INVALID');
  }
  parseGoogleSecretManagerRef(credentialSecretRef);

  if (
    authorization.providerAdapterId !== adapterId ||
    authorization.providerAdapterVersion !== adapterVersion ||
    authorization.credentialSecretRef !== credentialSecretRef
  ) {
    throw new Error('FISCAL_PRODUCTION_AUTHORIZATION_CONFIGURATION_MISMATCH');
  }

  const credential = input.credential;
  if (!credential) throw new Error('FISCAL_PRODUCTION_CREDENTIAL_REQUIRED');
  if (
    clean(credential.secretRef, 320) !== credentialSecretRef ||
    !clean(credential.version, 120) ||
    !clean(credential.resourceName, 420) ||
    !credential.value
  ) {
    throw new Error('FISCAL_PRODUCTION_CREDENTIAL_INVALID');
  }

  return { authorization, configuration, credential };
};
