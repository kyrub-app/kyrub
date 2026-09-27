export const COMMERCIAL_RECIPIENT_AUTHORITY_SCHEMA_VERSION = 1 as const;

export type CommercialPaymentContext =
  | 'store_sale'
  | 'store_subscription'
  | 'platform_plan_subscription';

export type CommercialRecipientKind = 'merchant_store' | 'platform';
export type CommercialCredentialAuthority =
  | 'store_oauth_vault'
  | 'platform_billing';

export interface CommercialRecipientAuthority {
  schemaVersion: typeof COMMERCIAL_RECIPIENT_AUTHORITY_SCHEMA_VERSION;
  context: CommercialPaymentContext;
  recipientKind: CommercialRecipientKind;
  beneficiaryPrincipalId: string;
  provider: 'mercado_pago';
  credentialAuthority: CommercialCredentialAuthority;
  credentialScopeId: string;
  canonicalStoreId: string;
  ownerUserId: string;
  externalAccountId: string;
  platformFeeMode: 'separate';
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validIdentity = (value: string): boolean =>
  Boolean(value) && value.length <= 180 && !value.includes('/');

const requireIdentity = (value: unknown, code: string): string => {
  const normalized = clean(value);
  if (!validIdentity(normalized)) throw new Error(code);
  return normalized;
};

export const buildStoreCommercialRecipientAuthority = (input: {
  context: 'store_sale' | 'store_subscription';
  canonicalStoreId: string;
  ownerUserId: string;
  credentialScopeId: string;
  externalAccountId: string;
}): CommercialRecipientAuthority => {
  const canonicalStoreId = requireIdentity(
    input.canonicalStoreId,
    'COMMERCIAL_RECIPIENT_STORE_INVALID'
  );
  const ownerUserId = requireIdentity(
    input.ownerUserId,
    'COMMERCIAL_RECIPIENT_OWNER_INVALID'
  );
  const credentialScopeId = requireIdentity(
    input.credentialScopeId,
    'COMMERCIAL_RECIPIENT_CREDENTIAL_SCOPE_INVALID'
  );
  const externalAccountId = requireIdentity(
    input.externalAccountId,
    'COMMERCIAL_RECIPIENT_EXTERNAL_ACCOUNT_INVALID'
  );

  // The existing store Mercado Pago OAuth vault is scoped to the legacy owner
  // identity. Reusing that scope is intentional; no provider token is copied.
  if (credentialScopeId !== ownerUserId) {
    throw new Error('COMMERCIAL_RECIPIENT_STORE_SCOPE_MISMATCH');
  }

  return {
    schemaVersion: COMMERCIAL_RECIPIENT_AUTHORITY_SCHEMA_VERSION,
    context: input.context,
    recipientKind: 'merchant_store',
    beneficiaryPrincipalId: `store:${canonicalStoreId}`,
    provider: 'mercado_pago',
    credentialAuthority: 'store_oauth_vault',
    credentialScopeId,
    canonicalStoreId,
    ownerUserId,
    externalAccountId,
    platformFeeMode: 'separate',
  };
};

export const buildPlatformPlanRecipientAuthority = (): CommercialRecipientAuthority => ({
  schemaVersion: COMMERCIAL_RECIPIENT_AUTHORITY_SCHEMA_VERSION,
  context: 'platform_plan_subscription',
  recipientKind: 'platform',
  beneficiaryPrincipalId: 'platform:kyrub',
  provider: 'mercado_pago',
  credentialAuthority: 'platform_billing',
  credentialScopeId: 'kyrub_billing',
  canonicalStoreId: '',
  ownerUserId: '',
  externalAccountId: '',
  platformFeeMode: 'separate',
});

export const isStoreCommercialRecipientAuthority = (
  authority: CommercialRecipientAuthority
): boolean =>
  authority.context === 'store_sale' || authority.context === 'store_subscription';
