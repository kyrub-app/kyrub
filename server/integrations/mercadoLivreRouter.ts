import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { beginMercadoLivreAuthorization, completeMercadoLivreAuthorization } from './mercadoLivreOauthService.js';
import { confirmMercadoLivreCatalogImport, previewMercadoLivreCatalog } from './mercadoLivreCatalogImportService.js';
import { ingestMercadoLivreNotification } from './mercadoLivreNotificationInboxService.js';
import { processMercadoLivreNotificationInboxItem } from './mercadoLivreNotificationProcessor.js';
import { decideMercadoLivreSyncProposal, listMercadoLivreSyncReviewQueue } from './mercadoLivreSyncReviewService.js';
import { applyApprovedMercadoLivreProposalToDraft, listMercadoLivreApprovedSyncProposals } from './mercadoLivreApprovedProposalApplyService.js';
import { finalizeMercadoLivreImportAsCanonicalKyrubProduct, listMercadoLivreImportDraftsForPreparation, prepareMercadoLivreImportAsKyrubCatalogDraft } from './mercadoLivreCatalogDraftPromotionService.js';
import { applyMercadoLivreSnapshotToBoundCanonicalProduct, listMercadoLivreBoundProductSyncQueue } from './mercadoLivreBoundProductSyncService.js';
import { captureMercadoLivreBindingBaseline, listMercadoLivreConflictResolutionQueue, resolveMercadoLivreBoundProductConflict } from './mercadoLivreConflictResolutionService.js';
import { listMercadoLivreOutboundPublicationProposals, proposeMercadoLivreExternalPublication } from './mercadoLivreOutboundPublicationService.js';
import { configureMercadoLivreOutboundRequirements, inspectMercadoLivreOutboundRequirements } from './mercadoLivreOutboundRequirementsService.js';
import { validateMercadoLivreOutboundConditionalRequirements } from './mercadoLivreOutboundConditionalValidationService.js';
import { validateMercadoLivreOutboundListing } from './mercadoLivreOutboundListingValidationService.js';
import { authorizeMercadoLivreOutboundPublication } from './mercadoLivreOutboundPublicationAuthorizationService.js';
import { executeAuthorizedMercadoLivrePublication } from './mercadoLivreOutboundPublicationExecutionService.js';
import { reconcileMercadoLivrePublishedItem } from './mercadoLivrePostPublicationReconciliationService.js';
import { listMercadoLivreBoundListingUpdateProposals, proposeMercadoLivreBoundListingUpdate } from './mercadoLivreBoundListingUpdateProposalService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
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
const errorCode = (error: unknown): string => (error instanceof Error ? error.message : String(error)).split(':')[0].slice(0, 80);
const mapError = (error: unknown): { status: number; message: string; code: string } => {
  const code = errorCode(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.', code };
  if (code === 'STORE_CONNECTION_FORBIDDEN') return { status: 403, message: 'Você não pode administrar conexões desta loja.', code };
  if (code.includes('INVALID') || code.includes('SELECTION') || code.includes('STATE_REQUIRED') || code.includes('CODE_REQUIRED') || code.includes('IDENTITY_MISMATCH')) return { status: 400, message: 'A solicitação de integração é inválida.', code };
  if (code.includes('NOT_FOUND')) return { status: 404, message: 'O registro selecionado não foi encontrado.', code };
  if (code.includes('NOT_CONNECTED') || code.includes('CONNECTION_INVALID')) return { status: 409, message: 'Conecte sua conta do Mercado Livre antes de continuar.', code };
  if (code.includes('CONFLICT') || code.includes('REQUIRED') || code.includes('ALREADY') || code.includes('STALE') || code.includes('NOT_APPROVED') || code.includes('UNAVAILABLE') || code.includes('NOT_LISTABLE') || code.includes('NOT_PREDICTED') || code.includes('NOT_READY') || code.includes('NOT_RECONCILABLE') || code.includes('EXPIRED') || code.includes('AMBIGUOUS')) return { status: 409, message: 'O registro não pode avançar no estado atual.', code };
  if (code.includes('CONFIG_MISSING')) return { status: 503, message: 'A integração Mercado Livre ainda não foi configurada pela plataforma.', code };
  console.error('[Mercado Livre Integration]', code);
  return { status: 503, message: 'A integração Mercado Livre está temporariamente indisponível.', code };
};
const isNonRetryableNotificationError = (code: string): boolean => code.startsWith('MERCADO_LIVRE_NOTIFICATION_') && (code.endsWith('_INVALID') || code === 'MERCADO_LIVRE_NOTIFICATION_INVALID');

export const createMercadoLivreRouter = (): Router => {
  const router = Router();
  const ownerGet = (path: string, handler: (storeId: string, request: any) => Promise<unknown>) => router.get(path, async (request, response) => {
    try { const storeId = clean(request.params.storeId); await authenticatedOwner(request.get('authorization') ?? '', storeId); response.setHeader('Cache-Control', 'no-store, max-age=0'); response.json(await handler(storeId, request)); }
    catch (error) { const mapped = mapError(error); response.status(mapped.status).json({ error: mapped.message, code: mapped.code }); }
  });

  router.post('/notifications', async (request, response) => {
    try { const result = await ingestMercadoLivreNotification(request.body); if (!result.accepted) console.warn('[Mercado Livre notification ignored]', result.disposition); response.status(200).json({ received: true }); }
    catch (error) { const code = errorCode(error); if (isNonRetryableNotificationError(code)) { response.status(200).json({ received: true }); return; } console.error('[Mercado Livre notification inbox]', code); response.status(503).json({ received: false }); }
  });

  ownerGet('/:storeId/sync-proposals', (storeId, request) => listMercadoLivreSyncReviewQueue({ storeId, limit: Number(request.query.limit ?? 50) }));
  ownerGet('/:storeId/sync-proposals-approved', (storeId, request) => listMercadoLivreApprovedSyncProposals({ storeId, limit: Number(request.query.limit ?? 50) }));
  ownerGet('/:storeId/bound-product-sync', (storeId, request) => listMercadoLivreBoundProductSyncQueue({ storeId, limit: Number(request.query.limit ?? 50) }));
  ownerGet('/:storeId/conflict-resolutions', (storeId, request) => listMercadoLivreConflictResolutionQueue({ storeId, limit: Number(request.query.limit ?? 50) }));
  ownerGet('/:storeId/outbound-publication-proposals', (storeId, request) => listMercadoLivreOutboundPublicationProposals({ storeId, limit: Number(request.query.limit ?? 50) }));
  ownerGet('/:storeId/outbound-update-proposals', (storeId, request) => listMercadoLivreBoundListingUpdateProposals({ storeId, limit: Number(request.query.limit ?? 50) }));
  ownerGet('/:storeId/catalog-import-drafts', (storeId, request) => listMercadoLivreImportDraftsForPreparation({ storeId, limit: Number(request.query.limit ?? 50) }));
  ownerGet('/:storeId/catalog-preview', (storeId, request) => previewMercadoLivreCatalog({ storeId, limit: Number(request.query.limit ?? 50) }));

  router.post('/:storeId/external-catalog-bindings/:bindingId/update-proposals', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.status(201).json(await proposeMercadoLivreBoundListingUpdate({storeId,bindingId:clean(request.params.bindingId),proposedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/outbound-publication-proposals', async (request, response) => { try { const storeId=clean(request.params.storeId); const identity=await authenticatedOwner(request.get('authorization')??'',storeId); response.status(201).json(await proposeMercadoLivreExternalPublication({storeId,connectionId:clean(request.body?.connectionId),canonicalProductId:clean(request.body?.canonicalProductId),proposedByUserId:identity.uid})); } catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});} });
  router.post('/:storeId/outbound-publication-proposals/:proposalId/inspect-requirements', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.json(await inspectMercadoLivreOutboundRequirements({storeId,proposalId:clean(request.params.proposalId),inspectedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/outbound-publication-proposals/:proposalId/configure-requirements', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.json(await configureMercadoLivreOutboundRequirements({storeId,proposalId:clean(request.params.proposalId),categoryId:request.body?.categoryId,listingTypeId:request.body?.listingTypeId,condition:request.body?.condition,attributes:request.body?.attributes,configuredByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/outbound-publication-proposals/:proposalId/validate-conditional-requirements', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.json(await validateMercadoLivreOutboundConditionalRequirements({storeId,proposalId:clean(request.params.proposalId),validatedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/outbound-publication-proposals/:proposalId/validate-listing', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.json(await validateMercadoLivreOutboundListing({storeId,proposalId:clean(request.params.proposalId),validatedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/outbound-publication-proposals/:proposalId/authorize-publication', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.status(201).json(await authorizeMercadoLivreOutboundPublication({storeId,proposalId:clean(request.params.proposalId),authorizedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/outbound-publication-authorizations/:authorizationId/execute', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.status(201).json(await executeAuthorizedMercadoLivrePublication({storeId,authorizationId:clean(request.params.authorizationId),authorizationToken:clean(request.body?.authorizationToken),executedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/outbound-publication-executions/:executionId/reconcile', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.setHeader('Cache-Control','no-store, max-age=0');response.json(await reconcileMercadoLivrePublishedItem({storeId,executionId:clean(request.params.executionId),reconciledByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});

  router.post('/:storeId/sync-proposals/:proposalId/decision', async (request, response) => { try { const storeId=clean(request.params.storeId); const identity=await authenticatedOwner(request.get('authorization')??'',storeId); response.json(await decideMercadoLivreSyncProposal({storeId,proposalId:clean(request.params.proposalId),decision:request.body?.decision,decidedByUserId:identity.uid})); } catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});} });
  router.post('/:storeId/sync-proposals/:proposalId/apply-to-draft', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.json(await applyApprovedMercadoLivreProposalToDraft({storeId,proposalId:clean(request.params.proposalId),appliedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/sync-proposals/:proposalId/apply-to-canonical', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);const applied=await applyMercadoLivreSnapshotToBoundCanonicalProduct({storeId,proposalId:clean(request.params.proposalId),appliedByUserId:identity.uid});await captureMercadoLivreBindingBaseline({storeId,bindingId:applied.bindingId,capturedByUserId:identity.uid});response.json(applied);}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/sync-proposals/:proposalId/resolve-conflict', async (request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.json(await resolveMercadoLivreBoundProductConflict({storeId,proposalId:clean(request.params.proposalId),choices:request.body?.choices,resolvedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/catalog-import-drafts/:draftId/prepare-kyrub-draft', async(request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);response.status(201).json(await prepareMercadoLivreImportAsKyrubCatalogDraft({storeId,importDraftId:clean(request.params.draftId),preparedByUserId:identity.uid}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/catalog-import-drafts/:draftId/create-kyrub-product',async(request,response)=>{try{const storeId=clean(request.params.storeId);const identity=await authenticatedOwner(request.get('authorization')??'',storeId);const created=await finalizeMercadoLivreImportAsCanonicalKyrubProduct({storeId,importDraftId:clean(request.params.draftId),kyrubCategory: request.body?.category,kyrubStock: request.body?.stock,kyrubPrice: request.body?.price,finalizedByUserId:identity.uid});await captureMercadoLivreBindingBaseline({storeId,bindingId:created.bindingId,capturedByUserId:identity.uid});response.status(201).json(created);}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/notifications/:inboxId/process',async(request,response)=>{try{const storeId=clean(request.params.storeId);await authenticatedOwner(request.get('authorization')??'',storeId);response.json(await processMercadoLivreNotificationInboxItem({inboxId:clean(request.params.inboxId),expectedStoreId:storeId}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.post('/:storeId/authorize',async(request,response)=>{try{const storeId=clean(request.params.storeId);await authenticatedOwner(request.get('authorization')??'',storeId);response.json({authorizationUrl:await beginMercadoLivreAuthorization(storeId)});}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  router.get('/callback',async(request,response)=>{try{await completeMercadoLivreAuthorization({code:clean(request.query.code),state:clean(request.query.state)});response.redirect(303,callbackRedirect('connected'));}catch(error){const code=errorCode(error);console.warn('[Mercado Livre OAuth callback]',code);response.redirect(303,callbackRedirect('error',code));}});
  router.post('/:storeId/catalog-import',async(request,response)=>{try{const storeId=clean(request.params.storeId);await authenticatedOwner(request.get('authorization')??'',storeId);response.status(201).json(await confirmMercadoLivreCatalogImport({storeId,itemIds:Array.isArray(request.body?.itemIds)?request.body.itemIds:[]}));}catch(error){const mapped=mapError(error);response.status(mapped.status).json({error:mapped.message,code:mapped.code});}});
  return router;
};
