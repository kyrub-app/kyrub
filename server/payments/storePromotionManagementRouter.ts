import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import {
  normalizeStorePromotion,
  type StorePromotion,
} from '../../src/utils/storePromotions.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const collectionPath = (storeId: string): string =>
  `stores/${storeId}/promotions`;

const mapError = (error: unknown): { status: number; message: string } => {
  const code = error instanceof Error ? error.message : String(error);
  if (code === 'AUTH_REQUIRED') return { status: 401, message: 'Faça login novamente.' };
  if (code === 'STORE_REPRESENTATION_FORBIDDEN') return { status: 403, message: 'Você não pode administrar esta loja.' };
  if (code === 'PROMOTION_CODE_CONFLICT') return { status: 409, message: 'Já existe um cupom com este código.' };
  if (code.startsWith('PROMOTION_')) return { status: 400, message: 'Revise os dados do cupom.' };
  console.error('[Promotion management]', error);
  return { status: 503, message: 'Não foi possível administrar os cupons agora.' };
};

const requireOwner = async (authorization: string, storeId: string): Promise<string> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({
    storeId,
    authenticatedUserId: identity.uid,
  });
  return identity.uid;
};

const parsePromotion = (
  body: Record<string, unknown>,
  storeId: string,
  ownerId: string,
  existing?: StorePromotion
): StorePromotion => {
  const now = new Date().toISOString();
  const id = existing?.id || clean(body.id) || `promo_${randomUUID()}`;
  return normalizeStorePromotion({
    id,
    storeId,
    code: clean(body.code),
    title: clean(body.title),
    badge: clean(body.badge),
    discountType: body.discountType === 'fixed' ? 'fixed' : 'percentage',
    discountValue: Number(body.discountValue),
    productIds: Array.isArray(body.productIds) ? body.productIds.map(clean).filter(Boolean) : [],
    eligibility: { mode: 'public' },
    active: body.active !== false,
    startsAt: clean(body.startsAt),
    endsAt: clean(body.endsAt),
    maxRedemptions: Number(body.maxRedemptions ?? 0),
    maxRedemptionsPerBuyer: Number(body.maxRedemptionsPerBuyer ?? 0),
    redemptionCount: existing?.redemptionCount ?? 0,
    createdBy: existing?.createdBy || ownerId,
    createdVia: existing?.createdVia || 'manual',
    actionId: existing?.actionId || `promotion_manual_${id}`,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
};

const ensureUniqueCode = async (
  storeId: string,
  promotion: StorePromotion
): Promise<void> => {
  const snapshot = await adminDb
    .collection(collectionPath(storeId))
    .where('code', '==', promotion.code)
    .limit(2)
    .get();
  if (snapshot.docs.some(document => document.id !== promotion.id)) {
    throw new Error('PROMOTION_CODE_CONFLICT');
  }
};

export const createStorePromotionManagementRouter = (): Router => {
  const router = Router();

  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId);
      if (!storeId) throw new Error('PROMOTION_STORE_REQUIRED');
      await requireOwner(request.get('authorization') ?? '', storeId);
      const snapshot = await adminDb.collection(collectionPath(storeId)).get();
      const promotions = snapshot.docs.flatMap(document => {
        try {
          return [normalizeStorePromotion({
            ...(document.data() as StorePromotion),
            id: document.id,
            storeId,
          })];
        } catch {
          return [];
        }
      });
      response.status(200).json({ promotions });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.post('/', async (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const storeId = clean(body.storeId);
      if (!storeId) throw new Error('PROMOTION_STORE_REQUIRED');
      const ownerId = await requireOwner(request.get('authorization') ?? '', storeId);
      const promotion = parsePromotion(body, storeId, ownerId);
      await ensureUniqueCode(storeId, promotion);
      await adminDb.doc(`${collectionPath(storeId)}/${promotion.id}`).set(promotion);
      response.status(201).json({ promotion });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.put('/:promotionId', async (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const storeId = clean(body.storeId);
      const promotionId = clean(request.params.promotionId);
      if (!storeId || !promotionId) throw new Error('PROMOTION_REQUIRED_FIELDS');
      const ownerId = await requireOwner(request.get('authorization') ?? '', storeId);
      const ref = adminDb.doc(`${collectionPath(storeId)}/${promotionId}`);
      const snapshot = await ref.get();
      if (!snapshot.exists) {
        response.status(404).json({ error: 'Cupom não encontrado.' });
        return;
      }
      const existing = normalizeStorePromotion({
        ...(snapshot.data() as StorePromotion),
        id: promotionId,
        storeId,
      });
      const promotion = parsePromotion({ ...body, id: promotionId }, storeId, ownerId, existing);
      await ensureUniqueCode(storeId, promotion);
      await ref.set(promotion);
      response.status(200).json({ promotion });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  router.patch('/:promotionId/active', async (request, response) => {
    try {
      const body = request.body && typeof request.body === 'object'
        ? request.body as Record<string, unknown>
        : {};
      const storeId = clean(body.storeId);
      const promotionId = clean(request.params.promotionId);
      if (!storeId || !promotionId || typeof body.active !== 'boolean') {
        throw new Error('PROMOTION_REQUIRED_FIELDS');
      }
      await requireOwner(request.get('authorization') ?? '', storeId);
      const ref = adminDb.doc(`${collectionPath(storeId)}/${promotionId}`);
      const snapshot = await ref.get();
      if (!snapshot.exists) {
        response.status(404).json({ error: 'Cupom não encontrado.' });
        return;
      }
      await ref.update({ active: body.active, updatedAt: new Date().toISOString() });
      response.status(200).json({ ok: true, active: body.active });
    } catch (error) {
      const mapped = mapError(error);
      response.status(mapped.status).json({ error: mapped.message });
    }
  });

  return router;
};
