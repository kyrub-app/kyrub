import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { deriveKyrubPlatformEconomics, type KyrubPlatformEconomicsSummary } from '../../shared/kyrubPlatformEconomics.js';
import { normalizeKyrubEconomicLedger, type KyrubEconomicLedger } from '../../shared/kyrubEconomicLedger.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';

const FINANCE_ROLES = new Set(['super_admin', 'finance']);
const MAX_LEDGER_SCAN = 1000;

interface AuthorizedFinanceAdmin {
  uid: string;
  role: string;
}

export interface PlatformEconomicsFilters {
  from?: string;
  to?: string;
  storeId?: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const parseDateFilter = (label: string, value: unknown): string => {
  const text = clean(value);
  if (!text) return '';
  const parsed = Date.parse(text);
  if (Number.isNaN(parsed)) throw new Error(`INVALID_${label.toUpperCase()}`);
  return new Date(parsed).toISOString();
};

export const authorizePlatformEconomics = async (
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
    !FINANCE_ROLES.has(role)
  ) {
    throw new Error('FORBIDDEN');
  }
  return { uid: decoded.uid, role };
};

const recordEconomicsAudit = async (
  admin: AuthorizedFinanceAdmin,
  filters: Required<PlatformEconomicsFilters>,
  scannedLedgers: number,
  includedLedgers: number
): Promise<void> => {
  const auditId = randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId,
    action: 'admin.platform_economics.viewed',
    actorId: admin.uid,
    actorRole: admin.role,
    targetType: 'control_plane',
    targetId: 'platform_economics',
    source: 'server',
    filters,
    scannedLedgers,
    includedLedgers,
    createdAt: FieldValue.serverTimestamp(),
  });
};

export const loadPlatformEconomicsSummary = async (
  filters: PlatformEconomicsFilters = {}
): Promise<KyrubPlatformEconomicsSummary> => {
  const from = parseDateFilter('from', filters.from);
  const to = parseDateFilter('to', filters.to);
  const storeId = clean(filters.storeId);
  if (from && to && Date.parse(from) > Date.parse(to)) {
    throw new Error('INVALID_PERIOD');
  }

  const snapshot = await adminDb
    .collectionGroup('economicLedgers')
    .orderBy('createdAt', 'desc')
    .limit(MAX_LEDGER_SCAN + 1)
    .get();
  const truncated = snapshot.size > MAX_LEDGER_SCAN;
  const documents = snapshot.docs.slice(0, MAX_LEDGER_SCAN);
  const ledgers = documents.flatMap(document => {
    try {
      const ledger = normalizeKyrubEconomicLedger(document.data() as KyrubEconomicLedger);
      if (storeId && ledger.storeId !== storeId) return [];
      const createdAt = Date.parse(ledger.createdAt);
      if (from && createdAt < Date.parse(from)) return [];
      if (to && createdAt > Date.parse(to)) return [];
      return [ledger];
    } catch {
      return [];
    }
  });

  return deriveKyrubPlatformEconomics({
    ledgers,
    scannedLedgers: documents.length,
    truncated,
  });
};

export const loadAuthorizedPlatformEconomics = async (
  authorization: string,
  filters: PlatformEconomicsFilters = {}
): Promise<KyrubPlatformEconomicsSummary> => {
  const admin = await authorizePlatformEconomics(authorization);
  const normalizedFilters = {
    from: parseDateFilter('from', filters.from),
    to: parseDateFilter('to', filters.to),
    storeId: clean(filters.storeId),
  };
  const summary = await loadPlatformEconomicsSummary(normalizedFilters);
  await recordEconomicsAudit(
    admin,
    normalizedFilters,
    summary.scannedLedgers,
    summary.includedLedgers
  );
  return summary;
};

export interface PlatformEconomicsErrorResponse {
  status: number;
  body: { error: string; code: string };
}

export const mapPlatformEconomicsError = (
  error: unknown
): PlatformEconomicsErrorResponse => {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : '';
  if (
    message === 'AUTH_REQUIRED' ||
    code === 'AUTH_REQUIRED' ||
    /id-token|expired|revoked/i.test(message)
  ) {
    return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    return { status: 403, body: { error: 'Acesso financeiro não autorizado.', code: 'FORBIDDEN' } };
  }
  if (message.startsWith('INVALID_')) {
    return { status: 400, body: { error: 'Período de consulta inválido.', code: message } };
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
  console.error('[Admin Platform Economics]', error);
  return {
    status: 503,
    body: { error: 'Não foi possível consultar a economia da plataforma agora.', code: 'ECONOMICS_UNAVAILABLE' },
  };
};

export const createPlatformEconomicsRouter = (): Router => {
  const router = Router();
  router.get('/summary', async (request: Request, response: Response) => {
    try {
      const summary = await loadAuthorizedPlatformEconomics(
        request.get('authorization') ?? '',
        {
          from: clean(request.query.from),
          to: clean(request.query.to),
          storeId: clean(request.query.storeId),
        }
      );
      response.setHeader('cache-control', 'no-store, max-age=0');
      response.json(summary);
    } catch (error) {
      const mapped = mapPlatformEconomicsError(error);
      response.status(mapped.status).json(mapped.body);
    }
  });
  return router;
};
