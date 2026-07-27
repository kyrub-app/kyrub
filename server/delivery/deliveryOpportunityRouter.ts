import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from '../firebaseAdmin';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const ESCALATION_COLLECTION = 'adminLogisticsEscalations';
const ESCALATION_DELAY_MS = 3 * 60 * 1000;

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const authenticatedTenantId = async (request: Request): Promise<string> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  return (await adminAuth.verifyIdToken(token, true)).uid;
};

const cronAuthorized = (request: Request): boolean => {
  const expected = process.env.INTEGRATION_CRON_SECRET?.trim();
  if (!expected) return false;
  return request.get('x-cron-secret')?.trim() === expected || bearerToken(request) === expected;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const orderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

const deliveryJobId = (tenantId: string, orderId: string): string =>
  `order-${createHash('sha256').update(`${tenantId}:${orderId}`).digest('hex')}`;

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (/não encontrado|não está pronto|não é uma entrega/i.test(message)) {
    response.status(409).json({ error: message });
    return;
  }
  console.error('[Kyrub Delivery Opportunity]', error);
  response.status(503).json({
    error: message || 'O mural de entregas está temporariamente indisponível.',
  });
};

export const publishKyrubDeliveryOpportunity = async (
  tenantId: string,
  orderId: string
): Promise<Record<string, unknown>> => {
  const orderSnapshot = await adminDb.doc(orderPath(tenantId, orderId)).get();
  const order = orderSnapshot.data() as Record<string, unknown> | undefined;
  if (!orderSnapshot.exists || !order) throw new Error('Pedido não encontrado.');
  if (order.fulfillmentType !== 'delivery') {
    throw new Error('Este pedido não é uma entrega.');
  }
  if (!['ready', 'out_for_delivery'].includes(clean(order.status))) {
    throw new Error('O pedido ainda não está pronto para entrega.');
  }

  const storeSnapshot = await adminDb.doc(`users/${tenantId}/stores/${tenantId}`).get();
  const store = storeSnapshot.data() as Record<string, unknown> | undefined;
  const id = deliveryJobId(tenantId, orderId);
  const reference = adminDb.doc(`${DELIVERY_COLLECTION}/${id}`);
  const existing = await reference.get();
  const now = Timestamp.now();
  const escalationAt = Timestamp.fromMillis(now.toMillis() + ESCALATION_DELAY_MS);
  const deliveryAddress = clean(order.deliveryAddress);

  const payload = {
    id,
    source: 'kyrub-order',
    sourceOrderId: orderId,
    storeId: tenantId,
    from: clean(store?.address) || clean(store?.name) || 'Estabelecimento Kyrub',
    to: deliveryAddress,
    distance: finite(order.distance),
    payment: finite(order.deliveryFee),
    status: existing.exists ? clean(existing.data()?.status) || 'available' : 'available',
    requestedBy: tenantId,
    acceptedBy: clean(existing.data()?.acceptedBy),
    orderTotal: finite(order.total),
    customerName: clean(order.buyerName),
    createdAt: existing.exists
      ? existing.data()?.createdAt ?? FieldValue.serverTimestamp()
      : FieldValue.serverTimestamp(),
    availableAt: existing.exists
      ? existing.data()?.availableAt ?? now
      : now,
    escalationAt: existing.exists
      ? existing.data()?.escalationAt ?? escalationAt
      : escalationAt,
    fallbackStatus: clean(existing.data()?.fallbackStatus) || 'waiting_kyrub',
    updatedAt: FieldValue.serverTimestamp(),
  };

  await reference.set(payload, { merge: true });
  return { ...payload, created: !existing.exists };
};

export const escalateUnacceptedKyrubDeliveries = async (): Promise<{
  checked: number;
  escalated: number;
}> => {
  const snapshot = await adminDb
    .collection(DELIVERY_COLLECTION)
    .where('status', '==', 'available')
    .limit(250)
    .get();
  let checked = 0;
  let escalated = 0;
  const now = Date.now();

  for (const document of snapshot.docs) {
    checked += 1;
    const data = document.data() as Record<string, unknown>;
    const escalationAt = data.escalationAt;
    const threshold = escalationAt instanceof Timestamp
      ? escalationAt.toMillis()
      : 0;
    if (!threshold || threshold > now) continue;
    if (clean(data.fallbackStatus) !== 'waiting_kyrub') continue;

    const didEscalate = await adminDb.runTransaction(async transaction => {
      const fresh = await transaction.get(document.ref);
      const current = fresh.data() as Record<string, unknown> | undefined;
      if (!fresh.exists || clean(current?.status) !== 'available') return false;
      if (clean(current?.fallbackStatus) !== 'waiting_kyrub') return false;

      const escalationReference = adminDb.doc(
        `${ESCALATION_COLLECTION}/${document.id}`
      );
      transaction.set(
        escalationReference,
        {
          id: document.id,
          deliveryJobId: document.id,
          sourceOrderId: clean(current?.sourceOrderId),
          storeId: clean(current?.storeId),
          status: 'awaiting_provider_routing',
          controlPlane: 'admin.kyrub.com',
          providerCandidates: [],
          reason: 'Nenhum entregador Kyrub aceitou em até 3 minutos.',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      transaction.update(document.ref, {
        fallbackStatus: 'queued_for_admin_logistics',
        fallbackQueuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (didEscalate) escalated += 1;
  }

  return { checked, escalated };
};

export const createDeliveryOpportunityRouter = (): Router => {
  const router = Router();

  router.post('/orders/:orderId/publish', async (request, response) => {
    try {
      const tenantId = await authenticatedTenantId(request);
      response.json(
        await publishKyrubDeliveryOpportunity(tenantId, request.params.orderId)
      );
    } catch (error) {
      errorResponse(response, error);
    }
  });

  const escalationHandler = async (request: Request, response: Response) => {
    if (!cronAuthorized(request)) {
      response.status(401).json({ error: 'Cron não autorizado.' });
      return;
    }
    try {
      response.json(await escalateUnacceptedKyrubDeliveries());
    } catch (error) {
      errorResponse(response, error);
    }
  };

  router.get('/internal/escalate', escalationHandler);
  router.post('/internal/escalate', escalationHandler);

  return router;
};
