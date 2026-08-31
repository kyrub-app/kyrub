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
import {
  applyApprovedMercadoLivreProposalToDraft,
  listMercadoLivreApprovedSyncProposals,
} from './mercadoLivreApprovedProposalApplyService.js';
import {
  finalizeMercadoLivreImportAsCanonicalKyrubProduct,
  listMercadoLivreImportDraftsForPreparation,
  prepareMercadoLivreImportAsKyrubCatalogDraft,
} from './mercadoLivreCatalogDraftPromotionService.js';
import {
  applyMercadoLivreSnapshotToBoundCanonicalProduct,
  listMercadoLivreBoundProductSyncQueue,
} from './mercadoLivreBoundProductSyncService.js';
import {
  captureMercadoLivreBindingBaseline,
  listMercadoLivreConflictResolutionQueue,
  resolveMercadoLivreBoundProductConflict,
} from './mercadoLivreConflictResolutionService.js';

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
    code.includes('REVIEW_TARGET_INVALID') ||
    code.includes('APPLY_TARGET_INVALID') ||
    code.includes('PREPARATION_TARGET_INVALID') ||
    code.includes('CANONICAL_PRODUCT_INPUT_INVALID') ||
    code.includes('BOUND_SYNC_TARGET_INVALID') ||
    code.includes('CONFLICT_RESOLUTION_INPUT_INVALID') ||
    code.includes('CONFLICT_BASELINE_TARGET_INVALID')
  ) {
    return { status: 400, message: 'A solicitação de integração é inválida.', code };
  }
  if (code.includes('INBOX_ID_INVALID') || code.includes('RESOURCE_UNSUPPORTED')) {
    return { status: 400, message: 'A notificação selecionada não pode ser processada.', code };
  }
  if (
    code.includes('INBOX_NOT_FOUND') ||
    code.includes('SYNC_PROPOSAL_NOT_FOUND') ||
    code.includes('IMPORT_DRAFT_NOT_FOUND') ||
    code.includes('PREPARATION_NOT_FOUND')
  ) {
    return { status: 404, message: 'O registro selecionado não foi encontrado.', code };
  }
  if (
    code.includes('NOT_PENDING') ||
    code.includes('ALREADY_DECIDED') ||
    code.includes('NOT_APPROVED') ||
    code.includes('DRAFT_CONFLICT') ||
    code.includes('PROPOSAL_STALE') ||
    code.includes('PREPARATION_CONFLICT') ||
    code.includes('PREPARATION_STALE') ||
    code.includes('PREPARATION_REQUIRED') ||
    code.includes('ALREADY_BOUND') ||
    code.includes('EXTERNAL_BINDING_CONFLICT') ||
    code.includes('EXTERNAL_BINDING_NOT_FOUND') ||
    code.includes('CANONICAL_PRODUCT_ID_CONFLICT') ||
    code.includes('CANONICAL_PRODUCT_PRICE_REQUIRED') ||
    code.includes('BOUND_CANONICAL_PRODUCT') ||
    code.includes('BOUND_SYNC_BASELINE_CONFLICT') ||
    code.includes('BOUND_SYNC_APPLICATION_CONFLICT') ||
    code.includes('CONFLICT_BASELINE') ||
    code.includes('CONFLICT_ALREADY_RESOLVED') ||
    code.includes('CONFLICT_NO_LONGER_PRESENT') ||
    code.includes('CONFLICT_RESOLUTION_CHOICE_REQUIRED') ||
    code.includes('CONFLICT_RESOLUTION_ALREADY_RECORDED') ||
    code === 'STORE_REQUIRED' ||
    code === 'CANONICAL_STORE_REQUIRED'
  ) {
    return { status: 409, message: 'O registro não pode avançar no estado atual.', code };
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
      if (!result.accepted) console.warn('[Mercado Livre notification ignored]', result.disposition);
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
      response.json(await listMercadoLivreSyncReviewQueue({ storeId, limit: Number(request.query.limit ?? 50) }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.get('/:storeId/sync-proposals-approved', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await listMercadoLivreApprovedSyncProposals({ storeId, limit: Number(request.query.limit ?? 50) }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.get('/:storeId/bound-product-sync', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await listMercadoLivreBoundProductSyncQueue({ storeId, limit: Number(request.query.limit ?? 50) }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.get('/:storeId/conflict-resolutions', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await listMercadoLivreConflictResolutionQueue({ storeId, limit: Number(request.query.limit ?? 50) }));
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
      response.json(await decideMercadoLivreSyncProposal({ storeId, proposalId, decision: request.body?.decision, decidedByUserId: identity.uid }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/sync-proposals/:proposalId/apply-to-draft', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const proposalId = clean(request.params.proposalId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await applyApprovedMercadoLivreProposalToDraft({ storeId, proposalId, appliedByUserId: identity.uid }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/sync-proposals/:proposalId/apply-to-canonical', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const proposalId = clean(request.params.proposalId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      const applied = await applyMercadoLivreSnapshotToBoundCanonicalProduct({ storeId, proposalId, appliedByUserId: identity.uid });
      await captureMercadoLivreBindingBaseline({ storeId, bindingId: applied.bindingId, capturedByUserId: identity.uid });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(applied);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/sync-proposals/:proposalId/resolve-conflict', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const proposalId = clean(request.params.proposalId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await resolveMercadoLivreBoundProductConflict({
        storeId,
        proposalId,
        choices: request.body?.choices,
        resolvedByUserId: identity.uid,
      }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.get('/:storeId/catalog-import-drafts', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await listMercadoLivreImportDraftsForPreparation({ storeId, limit: Number(request.query.limit ?? 50) }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/catalog-import-drafts/:draftId/prepare-kyrub-draft', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const importDraftId = clean(request.params.draftId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(201).json(await prepareMercadoLivreImportAsKyrubCatalogDraft({ storeId, importDraftId, preparedByUserId: identity.uid }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  router.post('/:storeId/catalog-import-drafts/:draftId/create-kyrub-product', async (request, response) => {
    try {
      const storeId = clean(request.params.storeId);
      const importDraftId = clean(request.params.draftId);
      const identity = await authenticatedOwner(request.get('authorization') ?? '', storeId);
      const created = await finalizeMercadoLivreImportAsCanonicalKyrubProduct({
        storeId,
        importDraftId,
        kyrubCategory: request.body?.category,
        kyrubStock: request.body?.stock,
        kyrubPrice: request.body?.price,
        finalizedByUserId: identity.uid,
      });
      await captureMercadoLivreBindingBaseline({ storeId, bindingId: created.bindingId, capturedByUserId: identity.uid });
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.status(201).json(created);
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
      response.json(await processMercadoLivreNotificationInboxItem({ inboxId, expectedStoreId: storeId }));
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
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await previewMercadoLivreCatalog({ storeId, limit: Number(request.query.limit ?? 50) }));
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
      response.status(201).json(await confirmMercadoLivreCatalogImport({ storeId, itemIds: request.body?.itemIds }));
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message, code: mapped.code });
    }
  });

  return router;
};
