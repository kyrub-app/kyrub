export type FiscalProductionDocumentFamily = 'nfce';

export interface FiscalProductionAuthorization {
  schemaVersion: 1;
  canonicalStoreId: string;
  documentFamily: FiscalProductionDocumentFamily;
  environment: 'production';
  status: 'enabled' | 'disabled';
  providerAdapterId: string;
  providerAdapterVersion: string;
  credentialSecretRef: string;
  authorizedByUserId: string;
  authorizedAt: string;
  authority: 'server_owned_fiscal_production_authorization';
}

export interface FiscalProductionExecutionGateInput {
  canonicalStoreId: string;
  documentFamily: FiscalProductionDocumentFamily;
  authorization: FiscalProductionAuthorization | null | undefined;
}

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

/**
 * Production fiscal execution is fail-closed by design.
 *
 * This contract does not submit, authorize, cancel or reconcile a fiscal
 * document. It only establishes the independent server-owned authorization
 * that a future production executor must require in addition to provider
 * configuration and production credentials.
 */
export const assertFiscalProductionExecutionAuthorized = (
  input: FiscalProductionExecutionGateInput
): FiscalProductionAuthorization => {
  const authorization = input.authorization;
  if (!authorization) throw new Error('FISCAL_PRODUCTION_AUTHORIZATION_REQUIRED');

  const canonicalStoreId = clean(input.canonicalStoreId, 160);
  if (
    !canonicalStoreId ||
    authorization.schemaVersion !== 1 ||
    clean(authorization.canonicalStoreId, 160) !== canonicalStoreId ||
    authorization.documentFamily !== input.documentFamily ||
    authorization.environment !== 'production' ||
    authorization.status !== 'enabled' ||
    !clean(authorization.providerAdapterId, 80) ||
    !clean(authorization.providerAdapterVersion, 40) ||
    !clean(authorization.credentialSecretRef, 320) ||
    !clean(authorization.authorizedByUserId, 160) ||
    !clean(authorization.authorizedAt, 80) ||
    authorization.authority !== 'server_owned_fiscal_production_authorization'
  ) {
    throw new Error('FISCAL_PRODUCTION_AUTHORIZATION_INVALID');
  }

  return authorization;
};
