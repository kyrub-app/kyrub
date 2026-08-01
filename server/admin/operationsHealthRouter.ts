import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '../firebaseAdmin';

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
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (decoded.email_verified !== true) throw new Error('EMAIL_NOT_VERIFIED');

  const profileSnapshot = await adminDb
    .doc(`kyrub_admin/control_plane/admins/${decoded.uid}`)
    .get();
  const profile = profileSnapshot.data() as Record<string, unknown> | undefined;
  const role = clean(profile?.role);
  if (
    !profileSnapshot.exists ||
    clean(profile?.uid) !== decoded.uid ||
    clean(profile?.status) !== 'active' ||
    !SYSTEM_HEALTH_ROLES.has(role)
  ) {
    throw new Error('FORBIDDEN');
  }

  return { uid: decoded.uid, role };
};

const countWhere = async (
  collectionPath: string,
  field: string,
  value: string
): Promise<number> => {
  const result = await adminDb
    .collection(collectionPath)
    .where(field, '==', value)
    .count()
    .get();
  return result.data().count;
};

const recordHealthAudit = async (admin: AuthorizedAdmin): Promise<void> => {
  const auditId = randomUUID().replaceAll('-', '_');
  await adminDb
    .doc(`kyrub_admin/control_plane/audit_logs/${auditId}`)
    .set({
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

export interface OperationsHealthSnapshot {
  generatedAt: string;
  state: 'healthy' | 'attention' | 'critical';
  integration: {
    queued: number;
    processing: number;
    failed: number;
    connected: number;
    attention: number;
  };
  delivery: {
    available: number;
    accepted: number;
    delivering: number;
    waitingFallback: number;
    providerEscalations: number;
  };
}

export const loadOperationsHealthSnapshot = async (): Promise<OperationsHealthSnapshot> => {
  const [
    queued,
    processing,
    failed,
    connected,
    connectionAttention,
    available,
    accepted,
    delivering,
    waitingFallback,
    providerEscalations,
  ] = await Promise.all([
    countWhere('integrationIngress', 'status', 'queued'),
    countWhere('integrationIngress', 'status', 'processing'),
    countWhere('integrationIngress', 'status', 'failed'),
    countWhere('integrationConnections', 'status', 'connected'),
    countWhere('integrationConnections', 'status', 'attention'),
    countWhere('hub/renda/deliveries', 'status', 'available'),
    countWhere('hub/renda/deliveries', 'status', 'accepted'),
    countWhere('hub/renda/deliveries', 'status', 'delivering'),
    countWhere('deliveryEscalationQueue', 'status', 'waiting'),
    countWhere(
      'adminLogisticsEscalations',
      'status',
      'awaiting_provider_routing'
    ),
  ]);

  const critical = failed > 0 || connectionAttention > 0;
  const attention = queued > 0 || waitingFallback > 0 || providerEscalations > 0;

  return {
    generatedAt: new Date().toISOString(),
    state: critical ? 'critical' : attention ? 'attention' : 'healthy',
    integration: {
      queued,
      processing,
      failed,
      connected,
      attention: connectionAttention,
    },
    delivery: {
      available,
      accepted,
      delivering,
      waitingFallback,
      providerEscalations,
    },
  };
};

export const loadAuthorizedOperationsHealth = async (
  authorization: string
): Promise<OperationsHealthSnapshot> => {
  const admin = await authorizeOperationsHealth(authorization);
  const snapshot = await loadOperationsHealthSnapshot();
  await recordHealthAudit(admin);
  return snapshot;
};

export interface OperationsHealthErrorResponse {
  status: number;
  body: {
    error: string;
    code: string;
  };
}

export const mapOperationsHealthError = (
  error: unknown
): OperationsHealthErrorResponse => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    return {
      status: 401,
      body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' },
    };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return {
      status: 403,
      body: {
        error: 'Acesso ao painel de saúde não autorizado.',
        code: 'FORBIDDEN',
      },
    };
  }
  if (/default credentials|credential implementation|could not load/i.test(message)) {
    return {
      status: 503,
      body: {
        error: 'O backend administrativo ainda não possui credencial do Firebase neste ambiente.',
        code: 'ADMIN_BACKEND_NOT_CONFIGURED',
      },
    };
  }

  console.error('[Admin Operations Health]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível consultar a saúde operacional agora.',
      code: 'HEALTH_UNAVAILABLE',
    },
  };
};

const errorResponse = (response: Response, error: unknown): void => {
  const mapped = mapOperationsHealthError(error);
  response.status(mapped.status).json(mapped.body);
};

export const createOperationsHealthRouter = (): Router => {
  const router = Router();

  router.get('/', async (request: Request, response: Response) => {
    try {
      const snapshot = await loadAuthorizedOperationsHealth(
        request.get('authorization') ?? ''
      );
      response.json(snapshot);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
