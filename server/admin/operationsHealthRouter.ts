import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  loadAuthorizedIntegrationReadiness,
  mapIntegrationReadinessError,
} from './integrationReadinessService.js';
import {
  mapIntegrationCredentialError,
  saveAuthorizedGoogleMapsCredentials,
  saveAuthorizedMercadoPagoCredentials,
  testAuthorizedGoogleMapsConnection,
  testAuthorizedMercadoPagoConnection,
} from './integrationCredentialService.js';
import {
  loadAuthorizedCustomerArrivalPolicy,
  mapCustomerArrivalPolicyAdminError,
  saveAuthorizedCustomerArrivalPolicy,
} from './customerArrivalPolicyAdminService.js';
import { loadOperationalResponsibilityReviewQueue } from './operationalResponsibilityRouter.js';

const SYSTEM_HEALTH_ROLES = new Set(['super_admin', 'operations']);

interface AuthorizedAdmin {
  uid: string;
  role: string;
}

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const authorizeOperationsHealth = async (
  authorization: string
): Promise<AuthorizedAdmin> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await verifyFirebaseIdToken(token);
  if (decoded.emailVerified !== true) throw new Error('EMAIL_NOT_VERIFIED');

  const profileSnapshot = await adminDb.doc(`kyrub_admin/control_plane/admins/${decoded.uid}`).get();
  const profile = profileSnapshot.data() as Record<string, unknown> | undefined;
  const role = clean(profile?.role);
  if (
    !profileSnapshot.exists ||
    clean(profile?.uid) !== decoded.uid ||
    clean(profile?.status) !== 'active' ||
    !SYSTEM_HEALTH_ROLES.has(role)
  ) throw new Error('FORBIDDEN');
  return { uid: decoded.uid, role };
};

const countWhere = async (collectionPath: string, field: string, value: string): Promise<number> => {
  const result = await adminDb.collection(collectionPath).where(field, '==', value).count().get();
  return result.data().count;
};

const recordHealthAudit = async (admin: AuthorizedAdmin): Promise<void> => {
  const auditId = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId,
    action: 'admin.system_health.viewed',
    actorId: admin.uid,
    actorRole: admin.role,
    targetType: 'control_plane',
    targetId: 'system_health',
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

const recordResponsibilityReviewAudit = async (admin: AuthorizedAdmin): Promise<void> => {
  const auditId = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId,
    action: 'admin.operational_responsibility.review_queue_viewed',
    actorId: admin.uid,
    actorRole: admin.role,
    targetType: 'operational_responsibility',
    targetId: 'review_queue',
    source: 'server',
    createdAt: FieldValue.serverTimestamp(),
  });
};

export interface OperationsHealthSnapshot {
  generatedAt: string;
  state: 'healthy' | 'attention' | 'critical';
  integration: { queued: number; processing: number; failed: number; connected: number; attention: number };
  delivery: { available: number; accepted: number; delivering: number; waitingFallback: number; providerEscalations: number };
}

export const loadOperationsHealthSnapshot = async (): Promise<OperationsHealthSnapshot> => {
  const [queued, processing, failed, connected, connectionAttention, available, accepted, delivering, waitingFallback, providerEscalations] = await Promise.all([
    countWhere('integrationIngress', 'status', 'queued'),
    countWhere('integrationIngress', 'status', 'processing'),
    countWhere('integrationIngress', 'status', 'failed'),
    countWhere('integrationConnections', 'status', 'connected'),
    countWhere('integrationConnections', 'status', 'attention'),
    countWhere('hub/renda/deliveries', 'status', 'available'),
    countWhere('hub/renda/deliveries', 'status', 'accepted'),
    countWhere('hub/renda/deliveries', 'status', 'delivering'),
    countWhere('deliveryEscalationQueue', 'status', 'waiting'),
    countWhere('adminLogisticsEscalations', 'status', 'awaiting_provider_routing'),
  ]);
  const critical = failed > 0 || connectionAttention > 0;
  const attention = queued > 0 || waitingFallback > 0 || providerEscalations > 0;
  return {
    generatedAt: new Date().toISOString(),
    state: critical ? 'critical' : attention ? 'attention' : 'healthy',
    integration: { queued, processing, failed, connected, attention: connectionAttention },
    delivery: { available, accepted, delivering, waitingFallback, providerEscalations },
  };
};

export const loadAuthorizedOperationsHealth = async (authorization: string): Promise<OperationsHealthSnapshot> => {
  const admin = await authorizeOperationsHealth(authorization);
  const snapshot = await loadOperationsHealthSnapshot();
  await recordHealthAudit(admin);
  return snapshot;
};

export interface OperationsHealthErrorResponse {
  status: number;
  body: { error: string; code: string };
}

export const mapOperationsHealthError = (error: unknown): OperationsHealthErrorResponse => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  if (message === 'AUTH_REQUIRED' || code === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (code === 'AUTH_UNAVAILABLE') {
    return { status: 503, body: { error: 'Não foi possível validar a sessão administrativa agora.', code: 'AUTH_UNAVAILABLE' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, body: { error: 'Acesso ao painel de saúde não autorizado.', code: 'FORBIDDEN' } };
  }
  if (/default credentials|credential implementation|could not load/i.test(message)) {
    return { status: 503, body: { error: 'O backend administrativo ainda não possui credencial do Firebase neste ambiente.', code: 'ADMIN_BACKEND_NOT_CONFIGURED' } };
  }
  console.error('[Admin Operations Health]', error);
  return { status: 503, body: { error: 'Não foi possível consultar a saúde operacional agora.', code: 'HEALTH_UNAVAILABLE' } };
};

const errorResponse = (response: Response, error: unknown): void => {
  const mapped = mapOperationsHealthError(error);
  response.status(mapped.status).json(mapped.body);
};

export const createOperationsHealthRouter = (): Router => {
  const router = Router();

  router.get('/', async (request: Request, response: Response) => {
    const transport = clean(request.query.transport);
    if (transport === 'integration-readiness') {
      try {
        response.json(await loadAuthorizedIntegrationReadiness(request.get('authorization') ?? ''));
      } catch (error) {
        const mapped = mapIntegrationReadinessError(error);
        response.status(mapped.status).json(mapped.body);
      }
      return;
    }
    if (transport === 'customer-arrival-policy') {
      try {
        response.json(await loadAuthorizedCustomerArrivalPolicy(request.get('authorization') ?? ''));
      } catch (error) {
        const mapped = mapCustomerArrivalPolicyAdminError(error);
        response.status(mapped.status).json(mapped.body);
      }
      return;
    }
    if (transport === 'operational-responsibility-review') {
      try {
        const admin = await authorizeOperationsHealth(request.get('authorization') ?? '');
        const snapshot = await loadOperationalResponsibilityReviewQueue();
        await recordResponsibilityReviewAudit(admin);
        response.setHeader('Cache-Control', 'no-store, max-age=0');
        response.json(snapshot);
      } catch (error) {
        errorResponse(response, error);
      }
      return;
    }
    try {
      response.json(await loadAuthorizedOperationsHealth(request.get('authorization') ?? ''));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/', async (request: Request, response: Response) => {
    const transport = clean(request.query.transport);
    const authorization = request.get('authorization') ?? '';
    try {
      if (transport === 'mercado-pago-credentials') {
        const credential = await saveAuthorizedMercadoPagoCredentials({
          authorization,
          accessToken: request.body?.accessToken,
          webhookSecret: request.body?.webhookSecret,
        });
        response.json({ credential });
        return;
      }
      if (transport === 'mercado-pago-test') {
        const result = await testAuthorizedMercadoPagoConnection(authorization);
        response.status(result.ok ? 200 : 422).json(result);
        return;
      }
      if (transport === 'google-maps-credentials') {
        const credential = await saveAuthorizedGoogleMapsCredentials({
          authorization,
          apiKey: request.body?.apiKey,
        });
        response.json({ credential });
        return;
      }
      if (transport === 'google-maps-test') {
        const result = await testAuthorizedGoogleMapsConnection(authorization);
        response.status(result.ok ? 200 : 422).json(result);
        return;
      }
      if (transport === 'customer-arrival-policy') {
        response.json(await saveAuthorizedCustomerArrivalPolicy({
          authorization,
          policyId: request.body?.policyId,
          version: request.body?.version,
          radiusMeters: request.body?.radiusMeters,
          enabled: request.body?.enabled,
        }));
        return;
      }
      response.status(400).json({ error: 'Operação de integração inválida.', code: 'INVALID_INTEGRATION_TRANSPORT' });
    } catch (error) {
      if (transport === 'customer-arrival-policy') {
        const mapped = mapCustomerArrivalPolicyAdminError(error);
        response.status(mapped.status).json(mapped.body);
        return;
      }
      const mapped = mapIntegrationCredentialError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });

  return router;
};
