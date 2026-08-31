import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  assertMercadoLivrePlatformCredentialInput,
  MERCADO_LIVRE_PLATFORM_ENVIRONMENT,
  MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
  type MercadoLivrePlatformCredentialStatus,
} from '../../shared/mercadoLivrePlatformCredential.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  loadPlatformCredentialMetadata,
  markPlatformCredentialValidation,
  resolvePlatformCredentials,
  savePlatformCredentials,
} from '../integrations/platformCredentialStore.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';

const audit = async (input: {
  actorId: string;
  action: string;
  result: string;
}): Promise<void> => {
  const id = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${id}`).set({
    id,
    action: input.action,
    actorId: input.actorId,
    actorRole: 'super_admin',
    targetType: 'platform_integration',
    targetId: MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
    result: input.result,
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

const statusFromMetadata = async (): Promise<MercadoLivrePlatformCredentialStatus> => {
  const metadata = await loadPlatformCredentialMetadata(
    MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
    MERCADO_LIVRE_PLATFORM_ENVIRONMENT
  );
  return {
    configured: Boolean(
      metadata?.credentials.client_id &&
      metadata.credentials.client_secret &&
      metadata.credentials.redirect_uri
    ),
    validated: metadata?.status === 'validated',
    clientIdLast4: metadata?.credentials.client_id?.last4,
    clientSecretLast4: metadata?.credentials.client_secret?.last4,
    redirectUriConfigured: Boolean(metadata?.credentials.redirect_uri),
    lastValidatedAt: metadata?.lastValidatedAt,
    validationCode: metadata?.lastValidationCode,
  };
};

export const loadAuthorizedMercadoLivrePlatformCredentialStatus = async (
  authorization: string
): Promise<MercadoLivrePlatformCredentialStatus> => {
  await authorizeIntegrationReadiness(authorization);
  return statusFromMetadata();
};

export const saveAuthorizedMercadoLivrePlatformCredentials = async (input: {
  authorization: string;
  clientId: unknown;
  clientSecret: unknown;
  redirectUri: unknown;
}): Promise<MercadoLivrePlatformCredentialStatus> => {
  const admin = await authorizeIntegrationReadiness(input.authorization);
  const credentials = assertMercadoLivrePlatformCredentialInput({
    clientId: typeof input.clientId === 'string' ? input.clientId : '',
    clientSecret: typeof input.clientSecret === 'string' ? input.clientSecret : '',
    redirectUri: typeof input.redirectUri === 'string' ? input.redirectUri : '',
  });

  await savePlatformCredentials({
    providerId: MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
    environment: MERCADO_LIVRE_PLATFORM_ENVIRONMENT,
    credentials: {
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      redirect_uri: credentials.redirectUri,
    },
  });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.mercado_livre.credentials.saved',
    result: 'configured',
  });
  return statusFromMetadata();
};

export const validateAuthorizedMercadoLivrePlatformConfiguration = async (
  authorization: string
): Promise<{ ok: boolean; code: string; credential: MercadoLivrePlatformCredentialStatus }> => {
  const admin = await authorizeIntegrationReadiness(authorization);
  let ok = false;
  let code = 'MERCADO_LIVRE_PLATFORM_CONFIGURATION_INVALID';
  try {
    const stored = await resolvePlatformCredentials(
      MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
      MERCADO_LIVRE_PLATFORM_ENVIRONMENT
    );
    assertMercadoLivrePlatformCredentialInput({
      clientId: stored?.client_id,
      clientSecret: stored?.client_secret,
      redirectUri: stored?.redirect_uri,
    });
    ok = true;
    code = 'CONFIGURATION_VALID';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    code = message.startsWith('MERCADO_LIVRE_') ? message.split(':')[0] : code;
  }

  await markPlatformCredentialValidation({
    providerId: MERCADO_LIVRE_PLATFORM_PROVIDER_ID,
    environment: MERCADO_LIVRE_PLATFORM_ENVIRONMENT,
    ok,
    code,
  });
  await audit({
    actorId: admin.uid,
    action: 'admin.integration.mercado_livre.configuration.validated',
    result: code,
  });
  return { ok, code, credential: await statusFromMetadata() };
};
