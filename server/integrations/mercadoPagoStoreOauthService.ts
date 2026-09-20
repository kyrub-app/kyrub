import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { resolvePlatformCredentials } from './platformCredentialStore.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault.js';
import {
  disconnectMercadoPagoStore,
  loadMercadoPagoStoreConnectionMetadata,
  loadMercadoPagoStoreTokenSecret,
  saveMercadoPagoStoreTokenSecret,
  type MercadoPagoStoreTokenSecret,
} from './mercadoPagoStoreConnectionSecretStore.js';

const AUTHORIZATION_ENDPOINT = 'https://auth.mercadopago.com/authorization';
const TOKEN_ENDPOINT = 'https://api.mercadopago.com/oauth/token';
const API_ORIGIN = 'https://api.mercadopago.com';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthStateDocument {
  stateHash: string;
  storeId: string;
  encryptedVerifier: EncryptedSecretEnvelope;
  expiresAtMillis: number;
}

interface TokenPayload {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  user_id?: unknown;
  error?: unknown;
  message?: unknown;
}

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const stateHash = (state: string): string => createHash('sha256').update(state).digest('hex');
const statePath = (hash: string): string => `integrationOauthStates/mercado_pago__${hash}`;
const stateAad = (hash: string): string => `oauth:mercado_pago:${hash}`;

export interface MercadoPagoPlatformOauthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export const resolveMercadoPagoPlatformOauthConfig = async (): Promise<MercadoPagoPlatformOauthConfig | null> => {
  let stored: Record<string, string | undefined> | null = null;
  try {
    stored = await resolvePlatformCredentials('mercado_pago', 'production');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/INTEGRATION_MASTER_KEY|PLATFORM_CREDENTIAL/i.test(message)) throw error;
  }
  const clientId = clean(stored?.client_id) || clean(process.env.MERCADO_PAGO_CLIENT_ID);
  const clientSecret = clean(stored?.client_secret) || clean(process.env.MERCADO_PAGO_CLIENT_SECRET);
  const redirectUri = clean(stored?.redirect_uri) || clean(process.env.MERCADO_PAGO_REDIRECT_URI);
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
};

const requireOauthConfig = async (): Promise<MercadoPagoPlatformOauthConfig> => {
  const config = await resolveMercadoPagoPlatformOauthConfig();
  if (!config) throw new Error('MERCADO_PAGO_OAUTH_PLATFORM_NOT_CONFIGURED');
  return config;
};

const tokenSecret = (
  payload: TokenPayload,
  fallbackRefreshToken = '',
  fallbackAccountId = ''
): MercadoPagoStoreTokenSecret => {
  const accessToken = clean(payload.access_token);
  const refreshToken = clean(payload.refresh_token) || fallbackRefreshToken;
  const externalAccountId = clean(payload.user_id) || fallbackAccountId;
  const expiresIn = Number(payload.expires_in);
  if (!accessToken || !refreshToken || !externalAccountId || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('MERCADO_PAGO_OAUTH_TOKEN_RESPONSE_INVALID');
  }
  return {
    accessToken,
    refreshToken,
    externalAccountId,
    tokenType: clean(payload.token_type) || 'bearer',
    scope: clean(payload.scope),
    expiresAtMillis: Date.now() + Math.floor(expiresIn * 1000),
  };
};

const requestToken = async (body: Record<string, string | boolean>): Promise<TokenPayload> => {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as TokenPayload;
  if (!response.ok) {
    const diagnostic = clean(payload.error) || clean(payload.message) || `HTTP_${response.status}`;
    throw new Error(`MERCADO_PAGO_OAUTH_TOKEN_EXCHANGE_FAILED:${diagnostic.slice(0, 80)}`);
  }
  return payload;
};

export const beginMercadoPagoStoreAuthorization = async (storeIdInput: string): Promise<string> => {
  const storeId = clean(storeIdInput);
  if (!storeId) throw new Error('MERCADO_PAGO_STORE_REQUIRED');
  const config = await requireOauthConfig();
  const state = randomBytes(32).toString('base64url');
  const hash = stateHash(state);
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  await adminDb.doc(statePath(hash)).create({
    stateHash: hash,
    storeId,
    encryptedVerifier: encryptIntegrationSecret({ verifier }, getIntegrationMasterKey(), stateAad(hash)),
    expiresAtMillis: Date.now() + OAUTH_STATE_TTL_MS,
    createdAt: FieldValue.serverTimestamp(),
  });

  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
};

const consumeState = async (stateInput: string): Promise<{ storeId: string; verifier: string }> => {
  const state = clean(stateInput);
  if (!state) throw new Error('MERCADO_PAGO_OAUTH_STATE_REQUIRED');
  const hash = stateHash(state);
  return adminDb.runTransaction(async transaction => {
    const reference = adminDb.doc(statePath(hash));
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('MERCADO_PAGO_OAUTH_STATE_INVALID');
    const data = snapshot.data() as OAuthStateDocument;
    if (data.stateHash !== hash || !data.storeId || !data.encryptedVerifier) {
      throw new Error('MERCADO_PAGO_OAUTH_STATE_INVALID');
    }
    if (!Number.isFinite(data.expiresAtMillis) || data.expiresAtMillis < Date.now()) {
      transaction.delete(reference);
      throw new Error('MERCADO_PAGO_OAUTH_STATE_EXPIRED');
    }
    const decrypted = decryptIntegrationSecret<{ verifier: string }>(
      data.encryptedVerifier,
      getIntegrationMasterKey(),
      stateAad(hash)
    );
    if (!clean(decrypted.verifier)) throw new Error('MERCADO_PAGO_OAUTH_PKCE_INVALID');
    transaction.delete(reference);
    return { storeId: data.storeId, verifier: decrypted.verifier };
  });
};

export const completeMercadoPagoStoreAuthorization = async (input: {
  code: string;
  state: string;
}): Promise<{ storeId: string; externalAccountId: string }> => {
  const code = clean(input.code);
  if (!code) throw new Error('MERCADO_PAGO_OAUTH_CODE_REQUIRED');
  const { storeId, verifier } = await consumeState(input.state);
  const config = await requireOauthConfig();
  const payload = await requestToken({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
    test_token: false,
  });
  const secret = tokenSecret(payload);
  await saveMercadoPagoStoreTokenSecret({ storeId, connectedByUserId: storeId, secret });
  return { storeId, externalAccountId: secret.externalAccountId };
};

export const getValidMercadoPagoStoreAccessToken = async (
  storeIdInput: string
): Promise<MercadoPagoStoreTokenSecret> => {
  const storeId = clean(storeIdInput);
  if (!storeId) throw new Error('MERCADO_PAGO_STORE_REQUIRED');
  const current = await loadMercadoPagoStoreTokenSecret(storeId);
  if (!current) throw new Error('MERCADO_PAGO_STORE_NOT_CONNECTED');
  if (current.expiresAtMillis > Date.now() + 5 * 60 * 1000) return current;
  const config = await requireOauthConfig();
  const payload = await requestToken({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: current.refreshToken,
  });
  const refreshed = tokenSecret(payload, current.refreshToken, current.externalAccountId);
  await saveMercadoPagoStoreTokenSecret({ storeId, connectedByUserId: storeId, secret: refreshed });
  return refreshed;
};

export const mercadoPagoStoreRequest = async <T>(
  storeId: string,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const secret = await getValidMercadoPagoStoreAccessToken(storeId);
  const response = await fetch(new URL(path, API_ORIGIN), {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${secret.accessToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & Record<string, unknown>;
  if (!response.ok) {
    const message = clean(payload.message) || clean(payload.error) || `HTTP_${response.status}`;
    throw new Error(`MERCADO_PAGO_STORE_API_ERROR:${message.slice(0, 120)}`);
  }
  return payload;
};

export const validateMercadoPagoStoreConnection = async (storeId: string): Promise<string> => {
  const profile = await mercadoPagoStoreRequest<{ id?: unknown }>(storeId, '/users/me');
  const externalAccountId = clean(profile.id);
  if (!externalAccountId) throw new Error('MERCADO_PAGO_STORE_PROFILE_INVALID');
  const secret = await getValidMercadoPagoStoreAccessToken(storeId);
  if (secret.externalAccountId !== externalAccountId) {
    throw new Error('MERCADO_PAGO_STORE_IDENTITY_MISMATCH');
  }
  return externalAccountId;
};

export const getMercadoPagoStoreConnectionStatus = async (storeId: string) => {
  const [config, metadata] = await Promise.all([
    resolveMercadoPagoPlatformOauthConfig(),
    loadMercadoPagoStoreConnectionMetadata(storeId),
  ]);
  return {
    provider: 'mercado_pago' as const,
    platformConfigured: Boolean(config),
    connected: metadata?.status === 'connected',
    externalAccountId: metadata?.externalAccountId ?? '',
    expiresAt: metadata?.expiresAtMillis
      ? new Date(metadata.expiresAtMillis).toISOString()
      : '',
  };
};

export { disconnectMercadoPagoStore };
