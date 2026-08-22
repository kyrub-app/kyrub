export type KyrubExternalAiProvider = 'openai' | 'gemini' | 'anthropic' | 'other';

export type KyrubExternalAiScope =
  | 'store.read'
  | 'products.read'
  | 'inventory.read'
  | 'orders.read'
  | 'notes.write'
  | 'tasks.write';

export interface KyrubExternalAiConnectionMetadata {
  id: string;
  ownerUid: string;
  provider: KyrubExternalAiProvider;
  status: 'pending' | 'active' | 'revoked' | 'attention';
  scopes: readonly KyrubExternalAiScope[];
  authMode: 'oauth' | 'delegated' | 'byo-provider';
  credentialAuthority: 'provider_oauth' | 'kyrub_vault_ref' | 'none';
  credentialRef: string;
  createdAt: string;
  updatedAt: string;
  revokedAt: string;
}

const READ_SCOPES: readonly KyrubExternalAiScope[] = [
  'store.read',
  'products.read',
  'inventory.read',
  'orders.read',
] as const;

export const KYRUB_EXTERNAL_AI_READ_ONLY_SCOPES = READ_SCOPES;

export const isExternalAiWriteScope = (scope: KyrubExternalAiScope): boolean =>
  scope.endsWith('.write');

export const validateExternalAiConnectionMetadata = (
  value: KyrubExternalAiConnectionMetadata
): void => {
  if (!value.id.trim() || !value.ownerUid.trim()) {
    throw new Error('EXTERNAL_AI_CONNECTION_IDENTITY_REQUIRED');
  }
  if (value.scopes.length === 0) {
    throw new Error('EXTERNAL_AI_SCOPE_REQUIRED');
  }
  if (value.credentialAuthority === 'none' && value.credentialRef.trim()) {
    throw new Error('EXTERNAL_AI_CREDENTIAL_REF_WITHOUT_AUTHORITY');
  }
  if (value.credentialAuthority !== 'none' && !value.credentialRef.trim()) {
    throw new Error('EXTERNAL_AI_CREDENTIAL_REF_REQUIRED');
  }
};

export const requiresGovernedActionLayer = (
  scopes: readonly KyrubExternalAiScope[]
): boolean => scopes.some(isExternalAiWriteScope);
