import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const DELIVERY_CLAIM_COLLECTION = 'deliveryClaims';
const DELIVERY_TRACKING_COLLECTION = 'deliveryTracking';
const DELIVERY_PICKUP_SECRET_COLLECTION = 'deliveryPickupSecrets';
const DELIVERY_PICKUP_MAX_ATTEMPTS = 5;

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const validId = (value: string, label: string): string => {
  const normalized = value.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) throw new Error(`${label} não foi identificado.`);
  return normalized;
};
const orderPath = (storeId: string, orderId: string): string => `artifacts/${storeId}/public/data/customerOrders/${orderId}`;
const codeHash = (deliveryId: string, code: string): Buffer => createHash('sha256').update(`${deliveryId}:${code}`).digest();
const safeCodeEqual = (deliveryId: string, expected: string, supplied: string): boolean => timingSafeEqual(codeHash(deliveryId, expected), codeHash(deliveryId, supplied));
const evidenceKind = (value: unknown): string => !value || typeof value !== 'object' || Array.isArray(value) ? '' : clean((value as Record<string, unknown>).kind);

export interface DeliveryPickupCodeResult {
  deliveryId: string;
  code: string;
  codeHint: string;
  attempts: number;
  maxAttempts: number;
}

type PickupAttemptResult =
  | { ok: true; deliveryId: string; status: 'delivering' }
  | { ok: false; nextAttempts: number; locked: boolean };

export const readOrCreateDeliveryPickupCodeForStore = async (input: { deliveryId: string; storeId: string }): Promise<DeliveryPickupCodeResult> => {
  const deliveryId = validId(input.deliveryId, 'A entrega');
  const storeId = validId(input.storeId, 'A loja');
  const deliveryRef = adminDb.doc(`${DELIVERY_COLLECTION}/${deliveryId}`);
  const secretRef = adminDb.doc(`${DELIVERY_PICKUP_SECRET_COLLECTION}/${deliveryId}`);

  return adminDb.runTransaction(async transaction => {
    const [deliverySnapshot, secretSnapshot] = await Promise.all([transaction.get(deliveryRef), transaction.get(secretRef)]);
    if (!deliverySnapshot.exists) throw new Error('A entrega não foi encontrada.');
    const delivery = deliverySnapshot.data() as Record<string, unknown>;
    if (clean(delivery.storeId) !== storeId) throw new Error('DELIVERY_PICKUP_FORBIDDEN');
    if (clean(delivery.source) !== 'kyrub-order') throw new Error('A coleta segura só se aplica a entregas Kyrub de pedidos.');
    if (!['accepted', 'delivering'].includes(clean(delivery.status))) throw new Error('A entrega precisa estar aceita para emitir o código de coleta.');

    const existingCode = clean(secretSnapshot.data()?.code);
    const existingAttempts = Number.isSafeInteger(secretSnapshot.data()?.attempts) ? Math.max(0, Number(secretSnapshot.data()?.attempts)) : 0;
    if (/^\d{6}$/.test(existingCode)) {
      return { deliveryId, code: existingCode, codeHint: existingCode.slice(-2), attempts: existingAttempts, maxAttempts: DELIVERY_PICKUP_MAX_ATTEMPTS };
    }
    if (clean(delivery.status) === 'delivering') throw new Error('A coleta desta entrega já foi confirmada.');

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    transaction.create(secretRef, {
      deliveryId,
      storeId,
      sourceOrderId: clean(delivery.sourceOrderId),
      code,
      attempts: 0,
      maxAttempts: DELIVERY_PICKUP_MAX_ATTEMPTS,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(deliveryRef, {
      pickupHandoff: { status: 'awaiting_code', method: 'delivery_pickup_code', codeHint: code.slice(-2), attempts: 0, maxAttempts: DELIVERY_PICKUP_MAX_ATTEMPTS },
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { deliveryId, code, codeHint: code.slice(-2), attempts: 0, maxAttempts: DELIVERY_PICKUP_MAX_ATTEMPTS };
  });
};

export const confirmSecureCourierPickupAndStartRoute = async (input: { deliveryId: string; courierId: string; handoffCode: string }): Promise<{ deliveryId: string; status: 'delivering' }> => {
  const deliveryId = validId(input.deliveryId, 'A entrega');
  const courierId = validId(input.courierId, 'O entregador');
  const handoffCode = clean(input.handoffCode).replace(/\D/g, '').slice(0, 6);
  if (!/^\d{6}$/.test(handoffCode)) throw new Error('Informe o código de coleta de 6 dígitos.');

  const deliveryRef = adminDb.doc(`${DELIVERY_COLLECTION}/${deliveryId}`);
  const claimRef = adminDb.doc(`${DELIVERY_CLAIM_COLLECTION}/${deliveryId}`);
  const trackingRef = adminDb.doc(`${DELIVERY_TRACKING_COLLECTION}/${deliveryId}`);
  const secretRef = adminDb.doc(`${DELIVERY_PICKUP_SECRET_COLLECTION}/${deliveryId}`);

  const result = await adminDb.runTransaction<PickupAttemptResult>(async transaction => {
    const [deliverySnapshot, claimSnapshot, trackingSnapshot, secretSnapshot] = await Promise.all([
      transaction.get(deliveryRef), transaction.get(claimRef), transaction.get(trackingRef), transaction.get(secretRef),
    ]);
    if (!deliverySnapshot.exists || !claimSnapshot.exists) throw new Error('A entrega não foi encontrada.');
    const delivery = deliverySnapshot.data() as Record<string, unknown>;
    const claim = claimSnapshot.data() as Record<string, unknown>;
    if (clean(claim.courierId) !== courierId) throw new Error('Somente o entregador responsável pode confirmar a coleta.');
    if (clean(delivery.status) === 'delivering') return { ok: true, deliveryId, status: 'delivering' };
    if (clean(delivery.status) !== 'accepted') throw new Error('A entrega precisa estar aceita antes da coleta.');
    if (clean(delivery.source) !== 'kyrub-order') throw new Error('A coleta segura só se aplica a entregas Kyrub de pedidos.');

    const tracking = trackingSnapshot.data() as Record<string, unknown> | undefined;
    if (!trackingSnapshot.exists || tracking?.active !== true) throw new Error('Ative o rastreio e chegue à loja antes de confirmar a coleta.');
    if (evidenceKind(tracking.storeArrivalEvidence) !== 'courier_inside_store_geofence') throw new Error('A chegada à loja ainda não foi confirmada pela geofence.');

    const storeId = validId(clean(delivery.storeId), 'A loja');
    const sourceOrderId = validId(clean(delivery.sourceOrderId), 'O pedido');
    const orderRef = adminDb.doc(orderPath(storeId, sourceOrderId));
    const orderSnapshot = await transaction.get(orderRef);
    if (!orderSnapshot.exists) throw new Error('O pedido vinculado à entrega não foi encontrado.');
    const liveOrderStatus = clean(orderSnapshot.data()?.status);
    if (liveOrderStatus !== 'ready') throw new Error('O pedido ainda não está pronto para coleta segura.');

    if (!secretSnapshot.exists) throw new Error('O código de coleta ainda não foi emitido pela loja.');
    const secret = secretSnapshot.data() as Record<string, unknown>;
    const expectedCode = clean(secret.code);
    const attempts = Number.isSafeInteger(secret.attempts) ? Math.max(0, Number(secret.attempts)) : 0;
    if (attempts >= DELIVERY_PICKUP_MAX_ATTEMPTS || clean(secret.lockedAt)) throw new Error('Código de coleta bloqueado após muitas tentativas.');
    if (!/^\d{6}$/.test(expectedCode)) throw new Error('O código de coleta ainda não foi emitido pela loja.');

    if (!safeCodeEqual(deliveryId, expectedCode, handoffCode)) {
      const nextAttempts = attempts + 1;
      const locked = nextAttempts >= DELIVERY_PICKUP_MAX_ATTEMPTS;
      transaction.update(secretRef, {
        attempts: nextAttempts,
        lastFailedAt: FieldValue.serverTimestamp(),
        ...(locked ? { lockedAt: FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(deliveryRef, {
        'pickupHandoff.attempts': nextAttempts,
        ...(locked ? { 'pickupHandoff.status': 'locked', 'pickupHandoff.lockedAt': FieldValue.serverTimestamp() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { ok: false, nextAttempts, locked };
    }

    const handoff = {
      status: 'handed_over',
      method: 'delivery_pickup_code',
      codeHint: expectedCode.slice(-2),
      verifiedByCourierId: courierId,
      storeArrivalEvidenceKind: 'courier_inside_store_geofence',
      attempts,
      verifiedAt: FieldValue.serverTimestamp(),
      handedOverAt: FieldValue.serverTimestamp(),
    };
    transaction.update(claimRef, { status: 'delivering', pickupHandoff: handoff, collectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    transaction.update(deliveryRef, { status: 'delivering', orderStatus: liveOrderStatus, pickupHandoff: handoff, collectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    transaction.delete(secretRef);
    return { ok: true, deliveryId, status: 'delivering' };
  });

  if (result.ok === false) {
    throw new Error(result.locked
      ? 'Código incorreto. A coleta foi bloqueada após 5 tentativas.'
      : `Código incorreto. Restam ${DELIVERY_PICKUP_MAX_ATTEMPTS - result.nextAttempts} tentativas.`);
  }
  return { deliveryId: result.deliveryId, status: result.status };
};
