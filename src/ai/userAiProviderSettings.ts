import { auth } from '../utils/firebase';

export type UserAiProviderId = 'google-gemini' | 'openai' | 'anthropic';

export type UserAiProviderStatus =
  | 'not_configured'
  | 'saved'
  | 'available'
  | 'invalid';

export type UserAiProviderMetadata = {
  provider: UserAiProviderId;
  configured: boolean;
  status: UserAiProviderStatus;
  masked?: string;
  fingerprint?: string;
  testedAt?: string;
};

export type UserAiProviderSettings = {
  providers: UserAiProviderMetadata[];
  preferredProvider: UserAiProviderId | null;
  preferenceUpdatedAt?: string;
};

const ENDPOINT = '/api/action-execute?transport=kyrubia-user-ai-provider';

const readJson = async (response: Response): Promise<Record<string, unknown>> => {
  const text = await response.text().catch(() => '');
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

const request = async (
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> => {
  const user = auth.currentUser;
  if (!user) throw new Error('Faça login novamente para configurar sua IA.');
  const token = await user.getIdToken();
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : 'Não foi possível atualizar a integração de IA agora.'
    );
  }
  return payload;
};

const providerIds = new Set<UserAiProviderId>([
  'google-gemini',
  'openai',
  'anthropic',
]);

const normalizeProvider = (value: unknown): UserAiProviderId | null =>
  typeof value === 'string' && providerIds.has(value as UserAiProviderId)
    ? value as UserAiProviderId
    : null;

const normalizeMetadata = (value: unknown): UserAiProviderMetadata | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const provider = normalizeProvider(raw.provider);
  if (!provider) return null;
  const allowedStatuses = new Set<UserAiProviderStatus>([
    'not_configured',
    'saved',
    'available',
    'invalid',
  ]);
  const status = typeof raw.status === 'string' &&
    allowedStatuses.has(raw.status as UserAiProviderStatus)
    ? raw.status as UserAiProviderStatus
    : 'not_configured';
  return {
    provider,
    configured: raw.configured === true,
    status,
    ...(typeof raw.masked === 'string' ? { masked: raw.masked } : {}),
    ...(typeof raw.fingerprint === 'string' ? { fingerprint: raw.fingerprint } : {}),
    ...(typeof raw.testedAt === 'string' ? { testedAt: raw.testedAt } : {}),
  };
};

export const loadUserAiProviderSettings = async (
  signal?: AbortSignal
): Promise<UserAiProviderSettings> => {
  const payload = await request({ operation: 'list' }, signal);
  return {
    providers: Array.isArray(payload.providers)
      ? payload.providers.map(normalizeMetadata).filter(
          (item): item is UserAiProviderMetadata => Boolean(item)
        )
      : [],
    preferredProvider: normalizeProvider(payload.preferredProvider),
    ...(typeof payload.preferenceUpdatedAt === 'string'
      ? { preferenceUpdatedAt: payload.preferenceUpdatedAt }
      : {}),
  };
};

export const saveUserAiProviderCredential = async (
  provider: UserAiProviderId,
  apiKey: string
): Promise<void> => {
  await request({ operation: 'save', provider, apiKey });
};

export const testUserAiProviderCredential = async (
  provider: UserAiProviderId
): Promise<void> => {
  await request({ operation: 'test', provider });
};

export const deleteUserAiProviderCredential = async (
  provider: UserAiProviderId
): Promise<void> => {
  await request({ operation: 'delete', provider });
};

export const setPreferredUserAiProvider = async (
  preferredProvider: UserAiProviderId | null
): Promise<void> => {
  await request({ operation: 'set_preference', preferredProvider });
};
