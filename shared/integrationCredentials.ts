export type KyrubIntegrationProviderId =
  | 'mercado_pago'
  | 'mercado_livre'
  | 'lalamove'
  | 'pagbank'
  | 'pagarme'
  | 'google_maps'
  | 'custom';

export type KyrubIntegrationEnvironment = 'sandbox' | 'production';
export type KyrubIntegrationStatus =
  | 'disconnected'
  | 'configured'
  | 'validated'
  | 'disabled'
  | 'error';

export interface KyrubSecretReferenceMetadata {
  /** Opaque reference resolved only by trusted server infrastructure. Never a raw secret. */
  secretRef: string;
  last4?: string;
  version?: string;
  updatedAt: string;
}

export interface KyrubIntegrationCredentialRecord {
  id: string;
  providerId: KyrubIntegrationProviderId;
  environment: KyrubIntegrationEnvironment;
  status: KyrubIntegrationStatus;
  enabled: boolean;
  credentials: Record<string, KyrubSecretReferenceMetadata>;
  lastValidatedAt?: string;
  lastValidationCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KyrubIntegrationProviderDefinition {
  providerId: KyrubIntegrationProviderId;
  title: string;
  category: 'payments' | 'logistics' | 'maps' | 'other';
  supportedEnvironments: KyrubIntegrationEnvironment[];
  credentialSlots: Array<{
    key: string;
    label: string;
    required: boolean;
  }>;
}

const forbiddenRawCredentialKeys = /^(access[_-]?token|refresh[_-]?token|token|api[_-]?key|api[_-]?secret|secret|client[_-]?secret|consumer[_-]?secret|password|private[_-]?key|webhook[_-]?secret)$/i;

const requiredText = (value: unknown, label: string): string => {
  const cleaned = typeof value === 'string' ? value.trim() : '';
  if (!cleaned) throw new Error(`${label} é obrigatório.`);
  return cleaned;
};

export const KYRUB_INTEGRATION_PROVIDERS: KyrubIntegrationProviderDefinition[] = [
  {
    providerId: 'mercado_pago',
    title: 'Mercado Pago',
    category: 'payments',
    supportedEnvironments: ['sandbox', 'production'],
    credentialSlots: [
      { key: 'access_token', label: 'Access Token', required: true },
      { key: 'webhook_secret', label: 'Webhook Secret', required: false },
    ],
  },
  {
    providerId: 'mercado_livre',
    title: 'Mercado Livre Platform',
    category: 'other',
    supportedEnvironments: ['production'],
    credentialSlots: [
      { key: 'client_id', label: 'Client ID', required: true },
      { key: 'client_secret', label: 'Client Secret', required: true },
      { key: 'redirect_uri', label: 'Redirect URI', required: true },
    ],
  },
  {
    providerId: 'lalamove',
    title: 'Lalamove',
    category: 'logistics',
    supportedEnvironments: ['sandbox', 'production'],
    credentialSlots: [
      { key: 'api_key', label: 'API Key', required: true },
      { key: 'api_secret', label: 'API Secret', required: true },
    ],
  },
];

export const assertNoRawIntegrationSecrets = (value: unknown, path = 'root'): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoRawIntegrationSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenRawCredentialKeys.test(key) && typeof child === 'string' && child.trim()) {
      throw new Error(`Segredo bruto proibido em ${path}.${key}. Armazene somente secretRef/metadados.`);
    }
    assertNoRawIntegrationSecrets(child, `${path}.${key}`);
  }
};

export const assertIntegrationCredentialRecord = (
  record: KyrubIntegrationCredentialRecord
): KyrubIntegrationCredentialRecord => {
  requiredText(record.id, 'integration.id');
  requiredText(record.providerId, 'integration.providerId');
  requiredText(record.createdAt, 'integration.createdAt');
  requiredText(record.updatedAt, 'integration.updatedAt');
  const provider = KYRUB_INTEGRATION_PROVIDERS.find(item => item.providerId === record.providerId);
  if (provider && !provider.supportedEnvironments.includes(record.environment)) {
    throw new Error(`Ambiente ${record.environment} não suportado por ${record.providerId}.`);
  }
  for (const [slot, candidate] of Object.entries(record.credentials)) {
    requiredText(slot, 'credential.slot');
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error(`credential.${slot} deve conter somente metadados de referência.`);
    }
    const metadata = candidate as KyrubSecretReferenceMetadata;
    requiredText(metadata.secretRef, `credential.${slot}.secretRef`);
    requiredText(metadata.updatedAt, `credential.${slot}.updatedAt`);
    if (metadata.last4 !== undefined && !/^[A-Za-z0-9_-]{1,4}$/.test(metadata.last4)) {
      throw new Error(`credential.${slot}.last4 inválido.`);
    }
  }
  assertNoRawIntegrationSecrets(record);
  return record;
};

export const publicIntegrationCredentialView = (
  record: KyrubIntegrationCredentialRecord
): Omit<KyrubIntegrationCredentialRecord, 'credentials'> & {
  credentials: Record<string, Omit<KyrubSecretReferenceMetadata, 'secretRef'> & { configured: true }>;
} => {
  assertIntegrationCredentialRecord(record);
  return {
    ...record,
    credentials: Object.fromEntries(Object.entries(record.credentials).map(([key, metadata]) => [key, {
      configured: true as const,
      ...(metadata.last4 ? { last4: metadata.last4 } : {}),
      ...(metadata.version ? { version: metadata.version } : {}),
      updatedAt: metadata.updatedAt,
    }])),
  };
};
