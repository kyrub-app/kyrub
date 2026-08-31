import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import {
  beginMercadoLivreAuthorization,
  completeMercadoLivreAuthorization,
} from './mercadoLivreOauthService.js';
import {
  confirmMercadoLivreCatalogImport,
  previewMercadoLivreCatalog,
} from './mercadoLivreCatalogImportService.js';
import { ingestMercadoLivreNotification } from './mercadoLivreNotificationInboxService.js';
import { processMercadoLivreNotificationInboxItem } from './mercadoLivreNotificationProcessor.js';
import {
  decideMercadoLivreSyncProposal,
  listMercadoLivreSyncReviewQueue,
} from './mercadoLivreSyncReviewService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const authenticatedOwner = async (authorization: string, storeId: string) => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  if (identity.uid !== storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');
  return identity;
};

const callbackRedirect = (status: 'connected' | 'error', code = ''): string => {
  const configured = process.env.PUBLIC_APP_URL?.trim();
  const base = configured && /^https?:\/\//i.test(configured) ? configured : '/';
  const url = new URL(base, 'http://localhost');
  url.searchParams.set('integration', 'mercado_livre');
  url.searchParams.set('status', status);
  if (code) url.searchParams.set('code', code);
  return configured ? url.toString() : `${url.pathname}${url.search}`;
};

const errorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(':')[0].slice(0, 80);
};

const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = errorCode(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.', code };
  if (code === 'STORE_CONNECTION_FORBIDDEN') {
    return { status: 403, message: 'Você não pode administrar conexões desta loja.', code };
  }
  if (
    code.includes('SELECTION') ||
    code.includes('STATE_REQUIRED') ||
    code.includes('CODE_REQUIRED') ||
    code.includes('REVIEW_DECISION_INVALID') ||
    code.includes('REVIEW_TARGET_INVALID')
  ) {
    return { status: 400, message: 'A solicitação de integração é inválida.', code };
  }
  if (code.includes('INBOX_ID_INVALID') || code.includes('RESOURCE_UNSUPPORTED')) {
    return { status: 400, message: 'A notificação selecionada não pode ser processada.', code };
  }
  if (code.includes('INBOX_NOT_FOUND') || code.includes('SYNC_PROPOSAL_NOT_FOUND')) {
    return { status: 404, message: 'O registro selecionado não foi encontrado.', code };
  }
  if (code.includes('NOT_PENDING') || code.includes('ALREADY_DECIDED')) {
    return { status: 409, message: 'Este registro já não está pendente de revisão.', code };
  }
  if (code.includes('NOT_CONNECTED') || code.includes('CONNECTION_INVALID')) {
    return { status: 409, message: 'Conecte sua conta do Mercado Livre antes de continuar.', code };
  }
  if (code.includes('CONFIG_MISSING')) {
    return { status: 503, message: 'A integração Mercado Livre ainda não foi configurada pela plataforma.', code };
  }
  console.error('[Mercado Livre Integration]', code);
  return { status: 503, message: 'A integração Mercado Livre está temporariamente indisponível.', code };
};

const isNonRetryableNotificationError = (code: string): boolean =>
  code.startsWith('MERCADO_LIVRE_NOTIFICATION_') &&
  (code.endsWith('_INVALID') || code === 'MERCADO_LIVRE_NOTIFICATION_INVALID');

export const createMercadoLivreRouter = (): Router => {
  const router = Router();

  router.post('/notifications', async (request, response) => {
    try {
      const result = await ingestMercadoLivreNotification(request.body);
      if (!result.accepted) {
        console.warn('[Mercado Livre notification ignored]', result.disposition);
      }
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(200).json({ received: true });
    } catch (error) {
      const code = errorCode(error);
      if (isNonRetryableNotificationError(code)) {
        console.warn('[Mercado Livre malformed notification]', code);
        response.status(200).json({ received: true });
        return;
      }
      console.error('[Mercado Livre notification inbox]', code);
      response.status(503).json({ received: false });
    }
  });

  router.get('/:storeId/sync-proposals', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await listMercadoLivreSyncReviewQueue({
        storeId,
        limit: Number(request.query.limit ?? 50),
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/sync-proposals/:proposalId/decision', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const proposalId = clean(request.params.proposalId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await decideMercadoLivreSyncProposal({
        storeId,
        proposalId,
        decision: request.body?.decision,
        decidedByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/notifications/:inboxId/process', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const inboxId = clean(request.params.inboxId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await processMercadoLivreNotificationInboxItem({
        inboxId,
        expectedStoreId: storeId,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/authorize', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      const authorizationUrl = await beginMercadoLivreAuthorization(storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json({ authorizationUrl });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.get('/callback', async (request, response) => {
    try {
      const code = clean(request.query.code);
      const state = clean(request.query.state);
      await completeMercadoLivreAuthorization({ code, state });
      response.redirect(303, callbackRedirect('connected'));
    } catch (error) {
      const code = errorCode(error);
      console.warn('[Mercado Livre OAuth callback]', code);
      response.redirect(303, callbackRedirect('error', code));
    }
  });

  router.get('/:storeId/catalog-preview', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      const limit = Number(request.query.limit ?? 50);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await previewMercadoLivreCatalog({ storeId, limit }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/catalog-import', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(201).json(await confirmMercadoLivreCatalogImport({
        storeId,
        itemIds: request.body?.itemIds,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
