import { Router } from 'express';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  listStoreCampaigns,
  previewStoreCampaignAudience,
  sendStoreCampaign,
} from './storeCampaignService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const requireCampaignRepresentation = async (input: {
  authorization: string;
  storeId: string;
}) => {
  const token = bearerToken(input.authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  const representation = await loadOwnerStoreInstitutionalRepresentation({
    storeId: input.storeId,
    authenticatedUserId: identity.uid,
  });
  if (!representation.capabilities.includes('notification_act')) {
    throw new Error('STORE_CAMPAIGN_FORBIDDEN');
  }
  return representation;
};

const mapError = (error: unknown): { status: number; message: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED') {
    return { status: 401, message: 'Faça login novamente para acessar campanhas.' };
  }
  if (
    message === 'STORE_REPRESENTATION_FORBIDDEN' ||
    message === 'STORE_CAMPAIGN_FORBIDDEN'
  ) {
    return { status: 403, message: 'Você não pode enviar campanhas por esta loja.' };
  }
  if (message === 'STORE_INSTITUTIONAL_NOT_FOUND') {
    return { status: 404, message: 'A identidade institucional da loja ainda não foi encontrada.' };
  }
  if (message === 'STORE_CAMPAIGN_AUDIENCE_EMPTY') {
    return { status: 409, message: 'Este segmento ainda não possui clientes no CRM.' };
  }
  if (message === 'STORE_CAMPAIGN_IDEMPOTENCY_CONFLICT') {
    return { status: 409, message: 'Esta chave de envio já foi usada com outro conteúdo.' };
  }
  if (
    message.startsWith('STORE_CAMPAIGN_') ||
    message.startsWith('STORE_INSTITUTIONAL_') ||
    message.startsWith('STORE_REPRESENTATION_')
  ) {
    console.warn('[Store campaigns]', message);
    return { status: 400, message: 'Os dados desta campanha são inválidos.' };
  }
  console.error('[Store campaigns]', error);
  return { status: 503, message: 'As campanhas estão temporariamente indisponíveis.' };
};

export const createStoreCampaignRouter = (): Router => {
  const router = Router();

  router.get('/preview', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_CAMPAIGN_STORE_REQUIRED');
      await requireCampaignRepresentation({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json(
        await previewStoreCampaignAudience({
          storeId,
          segment: request.query.segment,
        })
      );
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('STORE_CAMPAIGN_STORE_REQUIRED');
      await requireCampaignRepresentation({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      response.status(200).json({
        campaigns: await listStoreCampaigns({ storeId, limit: 20 }),
      });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/send', async (request, response) => {
    try {
      const storeId = clean(request.body?.storeId);
      if (!storeId) throw new Error('STORE_CAMPAIGN_STORE_REQUIRED');
      const representation = await requireCampaignRepresentation({
        authorization: request.get('authorization') ?? '',
        storeId,
      });
      const result = await sendStoreCampaign({
        storeId,
        actorPrincipalId: representation.identity.principalId,
        actorUserId: representation.authenticatedUserId,
        segment: request.body?.segment,
        title: request.body?.title,
        body: request.body?.body,
        idempotencyKey: request.body?.idempotencyKey,
      });
      response.status(result.duplicate ? 200 : 201).json(result);
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
