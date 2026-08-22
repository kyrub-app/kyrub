import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { KyrubiaAiProviderId } from '../../shared/kyrubiaAiRouting.js';
import { verifyFirebaseIdToken } from './consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from '../integrations/secretVault.js';

export type SupportedUserAiProvider = Extract<
  KyrubiaAiProviderId,
  'google-gemini' | 'openai' | 'anthropic'
>;

type ProviderSecret = {
  apiKey: string;
};

type ProviderCredentialDocument = {
  schemaVersion: 1;
  uid: string;
  provider: SupportedUserAiProvider;
  envelope: EncryptedSecretEnvelope;
  fingerprint: string;
  masked: string;
  status: 'saved' | 'available' | 'invalid';
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  testedAt?: Timestamp;
};

export type UserAiProviderCredentialMetadata = {
  provider: SupportedUserAiProvider;
  configured: boolean;
  status: 'not_configured' | 'saved' | 'available' | 'invalid';
  masked?: string;
  fingerprint?: string;
  testedAt?: string;
};

export class UserAiProviderCredentialError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'UserAiProviderCredentialError';
  }
}

export const mapUserAiProviderCredentialError = (
  error: unknown
): { status: number; body: { error: string; code: string } } => {
  if (error instanceof UserAiProviderCredentialError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code },
    };
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/INTEGRATION_MASTER_KEY/i.test(message)) {
    return {
      status: 503,
      body: {
        error: 'O cofre seguro de integrações não está disponível agora.',
        code: 'AI_PROVIDER_VAULT_UNAVAILABLE',
      },
    };
  }
  console.error('[Kyrubia AI Provider Vault]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível atualizar esta integração de IA agora.',
      code: 'AI_PROVIDER_CONFIGURATION_UNAVAILABLE',
    },
  };
};

const providerSet = new Set<SupportedUserAiProvider>([
  'google-gemini',
  'openai',
  'anthropic',
]);

const normalizeProvider = (value: unknown): SupportedUserAiProvider => {
  if (typeof value === 'string' && providerSet.has(value as SupportedUserAiProvider)) {
    return value as SupportedUserAiProvider;
  }
  throw new UserAiProviderCredentialError(
    400,
    'AI_PROVIDER_UNSUPPORTED',
    'Este provedor de IA ainda não é suportado para conexão direta.'
  );
};

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization.trim())?.[1]?.trim() ?? '';

const authenticatedUid = async (authorization: string): Promise<string> => {
  const token = bearerToken(authorization);
  if (!token) {
    throw new UserAiProviderCredentialError(
      401,
      'AUTH_REQUIRED',
      'Faça login novamente para configurar sua IA.'
    );
  }
  const user = await verifyFirebaseIdToken(token);
  return user.uid;
};

const credentialPath = (
  uid: string,
  provider: SupportedUserAiProvider
): string => `users/${uid}/server_private_ai/${provider}`;

const associatedDataFor = (
  uid: string,
  provider: SupportedUserAiProvider
): string => `kyrubia-ai-provider:${uid}:${provider}`;

const cleanApiKey = (value: unknown): string => {
  const apiKey = typeof value === 'string' ? value.trim() : '';
  if (apiKey.length < 12 || apiKey.length > 4096 || /\s/.test(apiKey)) {
    throw new UserAiProviderCredentialError(
      400,
      'AI_PROVIDER_CREDENTIAL_INVALID',
      'A credencial informada não possui um formato válido.'
    );
  }
  return apiKey;
};

const credentialFingerprint = (apiKey: string): string =>
  createHash('sha256').update(apiKey).digest('hex').slice(0, 16);

const maskedCredential = (apiKey: string): string =>
  `••••••••${apiKey.slice(-4)}`;

const isoTimestamp = (value: unknown): string | undefined =>
  value instanceof Timestamp ? value.toDate().toISOString() : undefined;

const metadataFrom = (
  provider: SupportedUserAiProvider,
  data?: Partial<ProviderCredentialDocument>
): UserAiProviderCredentialMetadata => {
  if (!data?.envelope) {
    return {
      provider,
      configured: false,
      status: 'not_configured',
    };
  }
  const testedAt = isoTimestamp(data.testedAt);
  return {
    provider,
    configured: true,
    status:
      data.status === 'available' || data.status === 'invalid'
        ? data.status
        : 'saved',
    ...(data.masked ? { masked: data.masked } : {}),
    ...(data.fingerprint ? { fingerprint: data.fingerprint } : {}),
    ...(testedAt ? { testedAt } : {}),
  };
};

const providerConnectionRequest = (
  provider: SupportedUserAiProvider,
  apiKey: string
): { url: string; headers: Record<string, string> } => {
  if (provider === 'google-gemini') {
    return {
      url: 'https://generativelanguage.googleapis.com/v1beta/models',
      headers: {
        accept: 'application/json',
        'x-goog-api-key': apiKey,
      },
    };
  }
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/models',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
    };
  }
  return {
    url: 'https://api.anthropic.com/v1/models',
    headers: {
      accept: 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  };
};

const verifyProviderCredential = async (
  provider: SupportedUserAiProvider,
  apiKey: string
): Promise<void> => {
  const request = providerConnectionRequest(provider, apiKey);
  let response: Response;
  try {
    response = await fetch(request.url, {
      method: 'GET',
      headers: request.headers,
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new UserAiProviderCredentialError(
      503,
      'AI_PROVIDER_UNAVAILABLE',
      'Não foi possível alcançar o provedor de IA agora.'
    );
  }

  if (response.ok) return;
  if (response.status === 401 || response.status === 403) {
    throw new UserAiProviderCredentialError(
      400,
      'AI_PROVIDER_CREDENTIAL_REJECTED',
      'O provedor recusou esta credencial.'
    );
  }
  if (response.status === 429) {
    throw new UserAiProviderCredentialError(
      409,
      'AI_PROVIDER_LIMIT_REACHED',
      'A credencial foi reconhecida, mas a conta está limitada no momento.'
    );
  }
  throw new UserAiProviderCredentialError(
    503,
    'AI_PROVIDER_UNAVAILABLE',
    'O provedor de IA não conseguiu validar a conexão agora.'
  );
};

const loadCredentialDocument = async (
  uid: string,
  provider: SupportedUserAiProvider
): Promise<ProviderCredentialDocument | null> => {
  const snapshot = await adminDb.doc(credentialPath(uid, provider)).get();
  return snapshot.exists
    ? snapshot.data() as ProviderCredentialDocument
    : null;
};

export const listAuthorizedUserAiProviderCredentials = async (
  authorization: string
): Promise<{ providers: UserAiProviderCredentialMetadata[] }> => {
  const uid = await authenticatedUid(authorization);
  const providers = [...providerSet];
  const snapshots = await Promise.all(
    providers.map(provider => adminDb.doc(credentialPath(uid, provider)).get())
  );
  return {
    providers: providers.map((provider, index) =>
      metadataFrom(
        provider,
        snapshots[index]?.exists
          ? snapshots[index]?.data() as ProviderCredentialDocument
          : undefined
      )
    ),
  };
};

export const saveAuthorizedUserAiProviderCredential = async (
  authorization: string,
  input: { provider?: unknown; apiKey?: unknown }
): Promise<UserAiProviderCredentialMetadata> => {
  const uid = await authenticatedUid(authorization);
  const provider = normalizeProvider(input.provider);
  const apiKey = cleanApiKey(input.apiKey);
  const reference = adminDb.doc(credentialPath(uid, provider));
  const previous = await reference.get();
  const envelope = encryptIntegrationSecret(
    { apiKey } satisfies ProviderSecret,
    getIntegrationMasterKey(),
    associatedDataFor(uid, provider)
  );
  const fingerprint = credentialFingerprint(apiKey);
  const masked = maskedCredential(apiKey);

  await reference.set(
    {
      schemaVersion: 1,
      uid,
      provider,
      envelope,
      fingerprint,
      masked,
      status: 'saved',
      createdAt: previous.exists
        ? previous.data()?.createdAt ?? FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      testedAt: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    provider,
    configured: true,
    status: 'saved',
    masked,
    fingerprint,
  };
};

export const testAuthorizedUserAiProviderCredential = async (
  authorization: string,
  providerValue: unknown
): Promise<UserAiProviderCredentialMetadata> => {
  const uid = await authenticatedUid(authorization);
  const provider = normalizeProvider(providerValue);
  const reference = adminDb.doc(credentialPath(uid, provider));
  const document = await loadCredentialDocument(uid, provider);
  if (!document?.envelope) {
    throw new UserAiProviderCredentialError(
      404,
      'AI_PROVIDER_NOT_CONFIGURED',
      'Salve a credencial deste provedor antes de testar a conexão.'
    );
  }

  const secret = decryptIntegrationSecret<ProviderSecret>(
    document.envelope,
    getIntegrationMasterKey(),
    associatedDataFor(uid, provider)
  );
  try {
    await verifyProviderCredential(provider, cleanApiKey(secret.apiKey));
    await reference.set(
      {
        status: 'available',
        testedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return {
      ...metadataFrom(provider, document),
      status: 'available',
      testedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (
      error instanceof UserAiProviderCredentialError &&
      error.code === 'AI_PROVIDER_CREDENTIAL_REJECTED'
    ) {
      await reference.set(
        {
          status: 'invalid',
          testedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    throw error;
  }
};

export const deleteAuthorizedUserAiProviderCredential = async (
  authorization: string,
  providerValue: unknown
): Promise<{ provider: SupportedUserAiProvider; deleted: true }> => {
  const uid = await authenticatedUid(authorization);
  const provider = normalizeProvider(providerValue);
  await adminDb.doc(credentialPath(uid, provider)).delete();
  return { provider, deleted: true };
};

export const resolveAuthorizedUserAiProviderSecret = async (
  uid: string,
  providerValue: unknown
): Promise<{ provider: SupportedUserAiProvider; apiKey: string } | null> => {
  const provider = normalizeProvider(providerValue);
  const document = await loadCredentialDocument(uid, provider);
  if (!document?.envelope || document.status !== 'available') return null;
  const secret = decryptIntegrationSecret<ProviderSecret>(
    document.envelope,
    getIntegrationMasterKey(),
    associatedDataFor(uid, provider)
  );
  return {
    provider,
    apiKey: cleanApiKey(secret.apiKey),
  };
};
