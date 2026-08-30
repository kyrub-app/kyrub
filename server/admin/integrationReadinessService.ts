import { randomUUID } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { kyrubCredentialVaultConfig } from '../integrations/kyrubCredentialVault.js';
import { loadPlatformCredentialMetadata } from '../integrations/platformCredentialStore.js';
import {
  isMercadoPagoPixConfigured,
  isMercadoPagoWebhookConfigured,
} from '../payments/mercadoPagoPixProvider.js';

interface AuthorizedIntegrationAdmin {
  uid: string;
  role: 'super_admin';
}

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export interface AdminIntegrationReadinessSnapshot {
  generatedAt: string;
  vault: {
    legacyEnvelopeConfigured: boolean;
    googleSecretManagerAdapterEnabled: boolean;
    googleSecretManagerState: 'disabled' | 'adapter-enabled-unverified';
  };
  providers: Array<{
    id: 'mercado_pago' | 'google_maps' | '99food' | 'lalamove';
    title: string;
    category: 'payments' | 'maps' | 'orders' | 'logistics';
    state: 'configured' | 'partial' | 'not-configured' | 'contract-only';
    credentialAuthority: 'environment' | 'legacy_envelope' | 'none';
    details: Record<string, boolean | number | string>;
  }>;
}

export const authorizeIntegrationReadiness = async (
  authorization: string
): Promise<AuthorizedIntegrationAdmin> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await verifyFirebaseIdToken(token);
  if (decoded.emailVerified !== true) throw new Error('EMAIL_NOT_VERIFIED');
  const profileSnapshot = await adminDb.doc(`kyrub_admin/control_plane/admins/${decoded.uid}`).get();
  const profile = profileSnapshot.data() as Record<string, unknown> | undefined;
  if (
    !profileSnapshot.exists ||
    clean(profile?.uid) !== decoded.uid ||
    clean(profile?.status) !== 'active' ||
    clean(profile?.role) !== 'super_admin'
  ) throw new Error('FORBIDDEN');
  return { uid: decoded.uid, role: 'super_admin' };
};

const loadProviderStatuses = async (provider: string): Promise<{ total: number; connected: number; attention: number }> => {
  const snapshot = await adminDb.collection('integrationConnections').where('provider', '==', provider).select('status').get();
  let connected = 0;
  let attention = 0;
  for (const document of snapshot.docs) {
    const status = clean(document.data().status);
    if (status === 'connected') connected += 1;
    if (status === 'attention') attention += 1;
  }
  return { total: snapshot.size, connected, attention };
};

const recordIntegrationReadinessAudit = async (admin: AuthorizedIntegrationAdmin): Promise<void> => {
  const auditId = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId,
    action: 'admin.integrations.readiness.viewed',
    actorId: admin.uid,
    actorRole: admin.role,
    targetType: 'control_plane',
    targetId: 'integrations',
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

export const loadIntegrationReadinessSnapshot = async (): Promise<AdminIntegrationReadinessSnapshot> => {
  const [ninetyNine, mercadoPagoVault, googleMapsVault] = await Promise.all([
    loadProviderStatuses('99food'),
    loadPlatformCredentialMetadata('mercado_pago', 'production'),
    loadPlatformCredentialMetadata('google_maps', 'production'),
  ]);
  const vault = kyrubCredentialVaultConfig();
  const envCheckout = isMercadoPagoPixConfigured();
  const envWebhook = isMercadoPagoWebhookConfigured();
  const vaultCheckout = Boolean(mercadoPagoVault?.credentials.access_token);
  const vaultWebhook = Boolean(mercadoPagoVault?.credentials.webhook_secret);
  const vaultAuthority = vaultCheckout || vaultWebhook;
  const mercadoPagoCheckout = vaultAuthority ? vaultCheckout : envCheckout;
  const mercadoPagoWebhook = vaultAuthority ? vaultCheckout && vaultWebhook : envWebhook;
  const mercadoPagoState = mercadoPagoCheckout && mercadoPagoWebhook ? 'configured' : mercadoPagoCheckout ? 'partial' : 'not-configured';
  const mercadoPagoAuthority = vaultAuthority ? 'legacy_envelope' : envCheckout || envWebhook ? 'environment' : 'none';
  const googleMapsConfigured = Boolean(googleMapsVault?.credentials.api_key);
  const googleMapsValidated = googleMapsVault?.status === 'validated';

  return {
    generatedAt: new Date().toISOString(),
    vault: {
      legacyEnvelopeConfigured: Boolean(process.env.INTEGRATION_MASTER_KEY?.trim()),
      googleSecretManagerAdapterEnabled: vault.enabled,
      googleSecretManagerState: vault.enabled ? 'adapter-enabled-unverified' : 'disabled',
    },
    providers: [
      {
        id: 'mercado_pago',
        title: 'Mercado Pago',
        category: 'payments',
        state: mercadoPagoState,
        credentialAuthority: mercadoPagoAuthority,
        details: {
          pixCheckoutConfigured: mercadoPagoCheckout,
          webhookConfigured: mercadoPagoWebhook,
          productionActivatedByVault: vaultCheckout,
        },
      },
      {
        id: 'google_maps',
        title: 'Google Maps Platform',
        category: 'maps',
        state: googleMapsValidated ? 'configured' : googleMapsConfigured ? 'partial' : 'not-configured',
        credentialAuthority: googleMapsConfigured ? 'legacy_envelope' : 'none',
        details: {
          apiKeyConfigured: googleMapsConfigured,
          geocodingConfigured: googleMapsValidated,
        },
      },
      {
        id: '99food',
        title: '99Food / Open Delivery',
        category: 'orders',
        state: ninetyNine.total === 0 ? 'not-configured' : ninetyNine.connected === ninetyNine.total && ninetyNine.attention === 0 ? 'configured' : 'partial',
        credentialAuthority: ninetyNine.total > 0 ? 'legacy_envelope' : 'none',
        details: { connections: ninetyNine.total, connected: ninetyNine.connected, attention: ninetyNine.attention },
      },
      {
        id: 'lalamove',
        title: 'Lalamove',
        category: 'logistics',
        state: 'contract-only',
        credentialAuthority: 'none',
        details: { runtimeConfigured: false, fallbackActivated: false },
      },
    ],
  };
};

export const loadAuthorizedIntegrationReadiness = async (
  authorization: string
): Promise<AdminIntegrationReadinessSnapshot> => {
  const admin = await authorizeIntegrationReadiness(authorization);
  const snapshot = await loadIntegrationReadinessSnapshot();
  await recordIntegrationReadinessAudit(admin);
  return snapshot;
};

export const mapIntegrationReadinessError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (message === 'AUTH_REQUIRED' || code === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED') return { status: 403, body: { error: 'Verifique seu e-mail antes de continuar.', code: 'EMAIL_NOT_VERIFIED' } };
  if (message === 'FORBIDDEN') return { status: 403, body: { error: 'Somente Super Admin pode consultar integrações da plataforma.', code: 'FORBIDDEN' } };
  console.error('[Admin Integrations Readiness]', error);
  return { status: 503, body: { error: 'Não foi possível consultar as integrações agora.', code: 'INTEGRATIONS_UNAVAILABLE' } };
};
