import { createHash, randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  MERCADO_LIVRE_API_ORIGIN,
  MERCADO_LIVRE_AUTHORIZATION_ENDPOINT,
  MERCADO_LIVRE_TOKEN_ENDPOINT,
} from '../../shared/mercadoLivreIntegration.js';
import {
  assertMercadoLivrePlatformCredentialInput,
  MERCADO_LIVRE_PLATFORM_ENVIRONMENT,
  MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
} from '../../shared/mercadoLivrePlatformCredential.js';
import type { KyrubStoreConnection } from '../../shared/storeConnections.js';
import { resolvePlatformCredentials } from './platformCredentialStore.js';
import { saveStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';
import {
  loadMercadoLivreTokenSecret,
  mercadoLivreCredentialReference,
  saveMercadoLivreTokenSecret,
  type MercadoLivreTokenSecret,
} from './storeConnectionSecretStore.js';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  type EncryptedSecretEnvelope,
} from './secretVault.js';

interface MercadoLivreOAuthStateDocument {
  state: string;
  storeId: string;
  encryptedVerifier: EncryptedSecretEnvelope;
  expiresAtMillis: number;
}

interface MercadoLivreTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  scope?: unknown;
  expires_in?: unknown;
  user_id?: unknown;
}

const statePath = (state: string): string => `integrationOauthStates/mercado_livre__${state}`;
const stateAad = (state: string): string => `oauth:mercado_livre:${state}`;

const oauthConfig = async () => {
  const stored = await resolvePlatformCredentials(
    MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
    MERCADO_LIVRE_PLATFORM_ENVIRONMENT
  );
  if (!stored) throw new Error('MERCADO_LIVRE_PLATFORM_NOT_CONFIGURED');
  return assertMercadoLivrePlatformCredentialInput({
    clientId: stored.client_id,
    clientSecret: stored.client_secret,
    redirectUri: stored.redirect_uri,
  });
};

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

const tokenSecretFromResponse = (
  payload: MercadoLivreTokenResponse,
  fallbackExternalAccountId = ''
): MercadoLivreTokenSecret => {
  const accessToken = text(payload.access_token);
  const refreshToken = text(payload.refresh_token);
  const externalAccountId = text(payload.user_id) || fallbackExternalAccountId;
  const expiresIn = Number(payload.expires_in);
  if (!accessToken || !refreshToken || !externalAccountId || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new Error('MERCADO_LIVRE_TOKEN_RESPONSE_INVALID');
  }
  return {
    accessToken,
    refreshToken,
    tokenType: text(payload.token_type) || 'bearer',
    scope: text(payload.scope),
    expiresAtMillis: Date.now() + Math.floor(expiresIn * 1000),
    externalAccountId,
  };
};

const tokenRequest = async (body: URLSearchParams): Promise<MercadoLivreTokenResponse> => {
  const response = await fetch(MERCADO_LIVRE_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await response.json().catch(() => ({})) as MercadoLivreTokenResponse & {
    error?: unknown;
    message?: unknown;
  };
  if (!response.ok) {
    const code = text(payload.error) || `HTTP_${response.status}`;
    throw new Error(`MERCADO_LIVRE_TOKEN_EXCHANGE_FAILED:${code}`);
  }
  return payload;
};

export const beginMercadoLivreAuthorization = async (storeIdInput: string): Promise<string> => {
  const storeId = storeIdInput.trim();
  if (!storeId) throw new Error('STORE_CONNECTION_STORE_REQUIRED');
  const config = await oauthConfig();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const expiresAtMillis = Date.now() + 10 * 60 * 1000;

  await adminDb.doc(statePath(state)).create({
    state,
    storeId,
    encryptedVerifier: encryptIntegrationSecret(
      { verifier },
      getIntegrationMasterKey(),
      stateAad(state)
    ),
    expiresAtMillis,
    createdAt: FieldValue.serverTimestamp(),
  });

  const url = new URL(MERCADO_LIVRE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
};

const consumeOAuthState = async (stateInput: string): Promise<{ storeId: string; verifier: string }> => {
  const state = stateInput.trim();
  if (!state) throw new Error('MERCADO_LIVRE_OAUTH_STATE_REQUIRED');
  return adminDb.runTransaction(async transaction => {
    const reference = adminDb.doc(statePath(state));
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('MERCADO_LIVRE_OAUTH_STATE_INVALID');
    const data = snapshot.data() as MercadoLivreOAuthStateDocument;
    if (data.state !== state || !data.storeId || !data.encryptedVerifier) {
      throw new Error('MERCADO_LIVRE_OAUTH_STATE_INVALID');
    }
    if (!Number.isFinite(data.expiresAtMillis) || data.expiresAtMillis < Date.now()) {
      transaction.delete(reference);
      throw new Error('MERCADO_LIVRE_OAUTH_STATE_EXPIRED');
    }
    const decrypted = decryptIntegrationSecret<{ verifier: string }>(
      data.encryptedVerifier,
      getIntegrationMasterKey(),
      stateAad(state)
    );
    if (!decrypted.verifier?.trim()) throw new Error('MERCADO_LIVRE_PKCE_VERIFIER_INVALID');
    transaction.delete(reference);
    return { storeId: data.storeId, verifier: decrypted.verifier };
  });
};

export const completeMercadoLivreAuthorization = async (input: {
  code: string;
  state: string;
}): Promise<{ storeId: string; connectionId: string; externalAccountId: string }> => {
  const code = input.code.trim();
  if (!code) throw new Error('MERCADO_LIVRE_AUTHORIZATION_CODE_REQUIRED');
  const { storeId, verifier } = await consumeOAuthState(input.state);
  const config = await oauthConfig();
  const payload = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier,
  }));
  const secret = tokenSecretFromResponse(payload);
  await saveMercadoLivreTokenSecret({ storeId, secret });

  const now = new Date().toISOString();
  const connectionId = `mercado_livre__${secret.externalAccountId}`;
  const connection: KyrubStoreConnection = {
    id: connectionId,
    scope: 'store',
    provider: 'mercado_livre',
    channel: 'mercado_livre',
    storeId,
    externalAccountId: secret.externalAccountId,
    syncAuthority: 'manual_review',
    connectedByUserId: storeId,
    status: 'connected',
    createdAt: now,
    updatedAt: now,
  };
  await saveStoreConnectionRegistryRecord({
    storeId,
    connection,
    credentialReference: mercadoLivreCredentialReference(storeId),
  });
  return { storeId, connectionId, externalAccountId: secret.externalAccountId };
};

export const getValidMercadoLivreAccessToken = async (storeIdInput: string): Promise<MercadoLivreTokenSecret> => {
  const storeId = storeIdInput.trim();
  const current = await loadMercadoLivreTokenSecret(storeId);
  if (!current) throw new Error('MERCADO_LIVRE_NOT_CONNECTED');
  if (current.expiresAtMillis > Date.now() + 60_000) return current;

  const config = await oauthConfig();
  const payload = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: current.refreshToken,
  }));
  const refreshed = tokenSecretFromResponse(payload, current.externalAccountId);
  await saveMercadoLivreTokenSecret({ storeId, secret: refreshed });
  return refreshed;
};

export const mercadoLivreGetJson = async <T>(storeId: string, path: string): Promise<T> => {
  const secret = await getValidMercadoLivreAccessToken(storeId);
  const url = new URL(path, MERCADO_LIVRE_API_ORIGIN);
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${secret.accessToken}`,
    },
  });
  if (!response.ok) throw new Error(`MERCADO_LIVRE_API_FAILED:HTTP_${response.status}`);
  return response.json() as Promise<T>;
};
