import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import { loadAdminPlatformEconomySnapshot } from './platformEconomyService.js';

const PLATFORM_ECONOMY_ROLES = new Set(['super_admin', 'finance']);

interface AuthorizedFinanceAdmin {
  uid: string;
  role: 'super_admin' | 'finance';
}

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const authorizePlatformEconomy = async (
  authorization: string
): Promise<AuthorizedFinanceAdmin> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await verifyFirebaseIdToken(token);
  if (decoded.emailVerified !== true) throw new Error('EMAIL_NOT_VERIFIED');

  const profileSnapshot = await adminDb
    .doc(`kyrub_admin/control_plane/admins/${decoded.uid}`)
    .get();
  const profile = profileSnapshot.data() as Record<string, unknown> | undefined;
  const role = clean(profile?.role);
  if (
    !profileSnapshot.exists ||
    clean(profile?.uid) !== decoded.uid ||
    clean(profile?.status) !== 'active' ||
    !PLATFORM_ECONOMY_ROLES.has(role)
  ) {
    throw new Error('FORBIDDEN');
  }

  return {
    uid: decoded.uid,
    role: role as AuthorizedFinanceAdmin['role'],
  };
};

const recordPlatformEconomyAudit = async (
  admin: AuthorizedFinanceAdmin
): Promise<void> => {
  const auditId = randomUUID().replaceAll('-', '_');
  await adminDb
    .doc(`kyrub_admin/control_plane/audit_logs/${auditId}`)
    .set({
      id: auditId,
      action: 'admin.platform_economy.viewed',
      actorId: admin.uid,
      actorRole: admin.role,
      targetType: 'control_plane',
      targetId: 'platform_economy',
      source: 'server',
      createdAt: FieldValue.serverTimestamp(),
    });
};

const mapError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';

  if (
    message === 'AUTH_REQUIRED' ||
    code === 'AUTH_REQUIRED' ||
    /id-token|expired|revoked/i.test(message)
  ) {
    return {
      status: 401,
      body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' },
    };
  }
  if (code === 'AUTH_UNAVAILABLE') {
    return {
      status: 503,
      body: {
        error: 'Não foi possível validar a sessão administrativa agora.',
        code: 'AUTH_UNAVAILABLE',
      },
    };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return {
      status: 403,
      body: {
        error: 'Acesso à economia da plataforma não autorizado.',
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

  console.error('[Admin Platform Economy]', error);
  return {
    status: 503,
    body: {
      error: 'Não foi possível consultar a economia da plataforma agora.',
      code: 'PLATFORM_ECONOMY_UNAVAILABLE',
    },
  };
};

export const createPlatformEconomyRouter = (): Router => {
  const router = Router();

  router.get('/', async (request: Request, response: Response) => {
    try {
      const admin = await authorizePlatformEconomy(
        request.get('authorization') ?? ''
      );
      const snapshot = await loadAdminPlatformEconomySnapshot();
      await recordPlatformEconomyAudit(admin);
      response.json(snapshot);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });

  return router;
};
