import { Router, type Request, type Response } from 'express';
import { adminAuth, adminDb } from '../firebaseAdmin.js';
import { authorizePlatformEconomy } from '../admin/platformEconomyRouter.js';
import {
  loadKyrubPaidWaitingFundingResponsibility,
  loadStorePaidWaitingFundingResponsibility,
} from './paidWaitingFundingResponsibilityService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (request: Request): string =>
  /^Bearer\s+(.+)$/i.exec(request.get('authorization') ?? '')?.[1]?.trim() ?? '';

const authenticatedCanonicalStoreId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await adminAuth.verifyIdToken(token, true);
  const tenantSnapshot = await adminDb.doc(`tenants/${decoded.uid}`).get();
  const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
  if (!tenantSnapshot.exists || !canonicalStoreId || canonicalStoreId.includes('/')) {
    throw new Error('CANONICAL_STORE_REQUIRED');
  }
  return canonicalStoreId;
};

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.', code: 'AUTH_REQUIRED' });
    return;
  }
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FORBIDDEN') {
    response.status(403).json({
      error: 'Acesso à responsabilidade econômica da plataforma não autorizado.',
      code: 'FORBIDDEN',
    });
    return;
  }
  if (message === 'CANONICAL_STORE_REQUIRED') {
    response.status(409).json({
      error: 'A loja canônica ainda não foi vinculada a esta conta.',
      code: 'CANONICAL_STORE_REQUIRED',
    });
    return;
  }
  console.error('[Paid Waiting Funding Responsibility]', error);
  response.status(503).json({
    error: 'Não foi possível consultar a responsabilidade de custeio agora.',
    code: 'PAID_WAITING_FUNDING_RESPONSIBILITY_UNAVAILABLE',
  });
};

export const createPaidWaitingFundingResponsibilityRouter = (): Router => {
  const router = Router();

  router.get('/store', async (request: Request, response: Response) => {
    try {
      const canonicalStoreId = await authenticatedCanonicalStoreId(request);
      response.json(await loadStorePaidWaitingFundingResponsibility(canonicalStoreId));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/kyrub', async (request: Request, response: Response) => {
    try {
      await authorizePlatformEconomy(request.get('authorization') ?? '');
      response.json(await loadKyrubPaidWaitingFundingResponsibility());
    } catch (error) {
      errorResponse(response, error);
    }
  });

  return router;
};
