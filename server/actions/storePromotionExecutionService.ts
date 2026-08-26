import type { CreateStorePromotionProposal } from '../../shared/storePromotionAction.js';
import { normalizeCreateStorePromotionProposal } from '../../shared/storePromotionAction.js';
import { normalizeStorePromotion, type StorePromotion } from '../../src/utils/storePromotions.js';
import { adminAuth, adminDb } from '../firebaseAdmin.js';
import { KyrubActionExecutionError } from './actionExecutionService.js';

const bearer = (authorization: string): string =>
  authorization.replace(/^Bearer\s+/i, '').trim();

const readProposal = (raw: unknown): CreateStorePromotionProposal | null => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const proposal = (raw as Record<string, unknown>).proposal;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null;
  const value = proposal as Record<string, unknown>;
  if (value.type !== 'create_store_promotion') return null;
  return value as unknown as CreateStorePromotionProposal;
};

const safeReceiptId = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);

const createdVia = (
  origin: CreateStorePromotionProposal['origin']
): StorePromotion['createdVia'] => {
  if (origin === 'manual') return 'manual';
  if (origin === 'kyrubia') return 'kyrubia';
  return 'api';
};

export const isKyrubStorePromotionExecutionRequest = (raw: unknown): boolean =>
  Boolean(readProposal(raw));

export const executeAuthorizedKyrubStorePromotion = async (
  authorization: string,
  raw: unknown
): Promise<any> => {
  const rawProposal = readProposal(raw);
  if (!rawProposal) {
    throw new KyrubActionExecutionError(
      400,
      'INVALID_STORE_PROMOTION',
      'A proposta de promoção da loja é inválida.'
    );
  }

  const request = raw as Record<string, unknown>;
  if (request.confirmed !== true || rawProposal.requiresConfirmation !== true) {
    throw new KyrubActionExecutionError(
      409,
      'CONFIRMATION_REQUIRED',
      'Esta promoção exige confirmação humana antes de ser publicada.'
    );
  }

  const token = bearer(authorization);
  if (!token) {
    throw new KyrubActionExecutionError(401, 'AUTH_REQUIRED', 'Autenticação obrigatória.');
  }

  const actor = await adminAuth.verifyIdToken(token);
  let proposal: CreateStorePromotionProposal;
  try {
    proposal = normalizeCreateStorePromotionProposal(
      rawProposal as CreateStorePromotionProposal & Record<string, unknown>
    );
  } catch (error) {
    throw new KyrubActionExecutionError(
      400,
      error instanceof Error ? error.message : 'PROMOTION_INVALID',
      'Revise os dados da promoção antes de confirmar.'
    );
  }

  if (proposal.storeId !== actor.uid) {
    throw new KyrubActionExecutionError(
      403,
      'STORE_PROMOTION_FORBIDDEN',
      'Você só pode publicar promoções na sua própria loja.'
    );
  }

  if (proposal.eligibilityMode !== 'public') {
    throw new KyrubActionExecutionError(
      409,
      'PROMOTION_ELIGIBILITY_NOT_AVAILABLE',
      'Nesta primeira versão, a promoção precisa ser pública. Clube, CRM e usuário específico serão liberados quando seus resolvedores autoritativos estiverem ativos.'
    );
  }

  const tenantRef = adminDb.doc(`tenants/${actor.uid}`);
  const tenantSnapshot = await tenantRef.get();
  if (!tenantSnapshot.exists) {
    throw new KyrubActionExecutionError(404, 'STORE_NOT_FOUND', 'A loja ativa não foi encontrada.');
  }

  const tenant = tenantSnapshot.data() as Record<string, unknown>;
  const publicProducts = Array.isArray(tenant.publicProducts) ? tenant.publicProducts : [];
  const publishedProductIds = new Set(
    publicProducts.flatMap(candidate => {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
      const id = String((candidate as Record<string, unknown>).id ?? '').trim();
      return id ? [id] : [];
    })
  );
  const missingProductIds = proposal.productIds.filter(id => !publishedProductIds.has(id));
  if (missingProductIds.length > 0) {
    throw new KyrubActionExecutionError(
      409,
      'PROMOTION_PRODUCT_NOT_PUBLISHED',
      'A promoção contém produto que não está publicado na vitrine atual.'
    );
  }

  const promotionRef = adminDb.doc(
    `stores/${actor.uid}/promotions/${proposal.code}`
  );
  const receiptId = safeReceiptId(proposal.idempotencyKey || proposal.id);
  const receiptRef = adminDb.doc(`users/${actor.uid}/actionReceipts/${receiptId}`);
  const now = new Date().toISOString();

  return adminDb.runTransaction(async transaction => {
    const [existingReceipt, existingPromotion] = await Promise.all([
      transaction.get(receiptRef),
      transaction.get(promotionRef),
    ]);

    if (existingReceipt.exists) {
      return {
        ...(existingReceipt.data() as Record<string, unknown>),
        status: 'already_applied',
      };
    }

    if (existingPromotion.exists) {
      const current = existingPromotion.data() as Record<string, unknown>;
      if (current.actionId === proposal.id) {
        return {
          actionId: proposal.id,
          type: proposal.type,
          status: 'already_applied',
          entityId: actor.uid,
          promotionId: proposal.code,
          couponCode: proposal.code,
          origin: proposal.origin || 'kyrubia',
          idempotencyKey: proposal.idempotencyKey || proposal.id,
        };
      }
      throw new KyrubActionExecutionError(
        409,
        'PROMOTION_CODE_CONFLICT',
        'Já existe uma promoção com este código. Escolha outro código de cupom.'
      );
    }

    const promotion = normalizeStorePromotion({
      id: proposal.code,
      storeId: actor.uid,
      code: proposal.code,
      title: proposal.title,
      badge: proposal.badge,
      discountType: proposal.discountType,
      discountValue: proposal.discountValue,
      productIds: proposal.productIds,
      eligibility: { mode: proposal.eligibilityMode },
      active: true,
      startsAt: proposal.startsAt,
      endsAt: proposal.endsAt,
      maxRedemptions: proposal.maxRedemptions,
      maxRedemptionsPerBuyer: proposal.maxRedemptionsPerBuyer,
      redemptionCount: 0,
      createdBy: actor.uid,
      createdVia: createdVia(proposal.origin),
      actionId: proposal.id,
      createdAt: now,
      updatedAt: now,
    });

    transaction.create(promotionRef, promotion);

    const result = {
      actionId: proposal.id,
      type: proposal.type,
      status: 'success',
      entityId: actor.uid,
      promotionId: promotion.id,
      couponCode: promotion.code,
      origin: proposal.origin || 'kyrubia',
      idempotencyKey: proposal.idempotencyKey || proposal.id,
    };
    transaction.create(receiptRef, { ...result, createdAt: now });
    return result;
  });
};
