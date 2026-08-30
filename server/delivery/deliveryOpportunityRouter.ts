import { createHash } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth, adminDb } from '../firebaseAdmin';
import {
  confirmSecureCourierPickupAndStartRoute,
  readOrCreateDeliveryPickupCodeForStore,
} from './deliveryPickupHandoffService.js';
import {
  confirmBuyerReceivedDelivery,
  markCourierArrivedAtCustomer,
} from './deliveryCustomerHandoffService.js';
import { loadCourierEarningsProjection } from './courierEarningsProjectionService.js';
import {
  DELIVERY_PAID_WAITING_POLICY_PATH,
  loadAuthoritativeDeliveryPaidWaitingPolicy,
} from './deliveryPaidWaitingPolicyService.js';
import {
  DELIVERY_RESPONSIBILITY_POLICY_PATH,
  loadAuthoritativeDeliveryResponsibilityPolicy,
} from './deliveryResponsibilityPolicyService.js';
import { materializeDeliveryResponsibilityAndWaitingDecision } from './deliveryResponsibilityDecisionOrchestrator.js';
import { buildDeliveryDestinationResolutionSnapshotFields } from './deliveryDestinationResolutionSnapshotService.js';

const DELIVERY_COLLECTION = 'hub/renda/deliveries';
const DELIVERY_CLAIM_COLLECTION = 'deliveryClaims';
const DELIVERY_ESCALATION_QUEUE = 'deliveryEscalationQueue';
const ESCALATION_COLLECTION = 'adminLogisticsEscalations';
const ESCALATION_DELAY_MS = 3 * 60 * 1000;

type DeliveryOperationalStatus = 'accepted' | 'delivering' | 'done';

interface AuthenticatedActor {
  uid: string;
  name: string;
}

const bearerToken = (request: Request): string => {
  const authorization = request.get('authorization') ?? '';
  return /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
};

const authenticatedToken = async (request: Request): Promise<DecodedIdToken> => {
  const token = bearerToken(request);
  if (!token) throw new Error('AUTH_REQUIRED');
  return adminAuth.verifyIdToken(token, true);
};

const authenticatedTenantId = async (request: Request): Promise<string> =>
  (await authenticatedToken(request)).uid;

const authenticatedActor = async (
  request: Request
): Promise<AuthenticatedActor> => {
  const decoded = await authenticatedToken(request);
  return {
    uid: decoded.uid,
    name:
      clean(decoded.name) ||
      clean(decoded.email) ||
      'Entregador Kyrub',
  };
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

const deliveryPath = (deliveryId: string): string =>
  `${DELIVERY_COLLECTION}/${deliveryId}`;
const claimPath = (deliveryId: string): string =>
  `${DELIVERY_CLAIM_COLLECTION}/${deliveryId}`;
const escalationQueuePath = (deliveryId: string): string =>
  `${DELIVERY_ESCALATION_QUEUE}/${deliveryId}`;

const validateDeliveryId = (deliveryId: string): string => {
  const normalized = deliveryId.trim();
  if (!normalized || !/^[a-zA-Z0-9_-]{1,128}$/.test(normalized)) {
    throw new Error('A entrega não foi identificada.');
  }
  return normalized;
};

const parseOperationalStatus = (value: unknown): DeliveryOperationalStatus => {
  if (value === 'accepted' || value === 'delivering' || value === 'done') {
    return value;
  }
  throw new Error('Status de entrega inválido.');
};

const errorResponse = (response: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) {
    response.status(401).json({ error: 'Faça login novamente.' });
    return;
  }
  if (message === 'DELIVERY_PICKUP_FORBIDDEN') {
    response.status(403).json({ error: 'Somente a loja desta entrega pode consultar o código de coleta.' });
    return;
  }
  if (message === 'DELIVERY_BUYER_CONFIRMATION_FORBIDDEN') {
    response.status(403).json({
      error: 'Somente o comprador deste pedido pode confirmar o recebimento.',
      code: 'DELIVERY_BUYER_CONFIRMATION_FORBIDDEN',
    });
    return;
  }
  if (/não identificado|inválido/i.test(message)) {
    response.status(400).json({ error: message });
    return;
  }
  if (
    /não encontrado|não está pronto|não é uma entrega|entregador próprio|já aceitou|já foi aceita|somente o entregador|precisa estar aceita|confirme a coleta|código|geofence|rastreio|chegue à loja|coleta segura|rota precisa|chegada ao cliente|ainda não informou|confirmação do cliente|completion|payable|capture|DELIVERY_DESTINATION_RESOLUTION_/i.test(
      message
    )
  ) {
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
  if (clean(order.deliveryProvider) !== 'kyrub') {
    throw new Error('Este pedido está configurado para entregador próprio.');
  }
  const orderStatus = clean(order.status);
  if (!['preparing', 'ready', 'out_for_delivery'].includes(orderStatus)) {
    throw new Error('O pedido ainda não iniciou o preparo para entrega.');
  }

  const storeSnapshot = await adminDb.doc(`users/${tenantId}/stores/${tenantId}`).get();
  const store = storeSnapshot.data() as Record<string, unknown> | undefined;
  const id = deliveryJobId(tenantId, orderId);
  const reference = adminDb.doc(deliveryPath(id));
  const scheduleReference = adminDb.doc(escalationQueuePath(id));
  const [existing, existingSchedule] = await Promise.all([
    reference.get(),
    scheduleReference.get(),
  ]);
  const now = Timestamp.now();
  const nowIso = now.toDate().toISOString();
  const escalationAt = Timestamp.fromMillis(now.toMillis() + ESCALATION_DELAY_MS);
  const deliveryAddress = clean(order.deliveryAddress);
  const destinationResolutionSnapshot = existing.exists
    ? null
    : buildDeliveryDestinationResolutionSnapshotFields(order);
  const [waitingPolicySnapshot, responsibilityPolicySnapshot] = existing.exists
    ? [null, null]
    : await Promise.all([
        loadAuthoritativeDeliveryPaidWaitingPolicy(),
        loadAuthoritativeDeliveryResponsibilityPolicy(nowIso),
      ]);

  const payload = {
    id,
    source: 'kyrub-order',
    sourceOrderId: orderId,
    storeId: tenantId,
    buyerId: clean(order.buyerId),
    orderStatus,
    from: clean(store?.address) || clean(store?.name) || 'Estabelecimento Kyrub',
    to: deliveryAddress,
    distance: finite(order.distance),
    payment: finite(order.deliveryFee),
    status: existing.exists ? clean(existing.data()?.status) || 'available' : 'available',
    requestedBy: tenantId,
    acceptedBy: clean(existing.data()?.acceptedBy),
    acceptedByName: clean(existing.data()?.acceptedByName),
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
    ...(existing.exists
      ? {}
      : {
          ...destinationResolutionSnapshot,
          customerDestinationResolutionSnapshottedAt: now,
          waitingPolicySnapshot,
          waitingPolicySnapshotStatus: waitingPolicySnapshot
            ? 'captured'
            : 'unavailable_or_disabled',
          waitingPolicySnapshotAuthority: 'kyrub_platform',
          waitingPolicySnapshotSource: DELIVERY_PAID_WAITING_POLICY_PATH,
          waitingPolicySnapshottedAt: now,
          responsibilityPolicySnapshot,
          responsibilityPolicySnapshotStatus: responsibilityPolicySnapshot
            ? 'captured'
            : 'unavailable_or_disabled',
          responsibilityPolicySnapshotAuthority: 'kyrub_platform',
          responsibilityPolicySnapshotSource: DELIVERY_RESPONSIBILITY_POLICY_PATH,
          responsibilityPolicySnapshottedAt: now,
        }),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = adminDb.batch();
  batch.set(reference, payload, { merge: true });
  if (!existingSchedule.exists) {
    batch.create(scheduleReference, {
      id,
      deliveryJobId: id,
      sourceOrderId: orderId,
      storeId: tenantId,
      status: 'waiting',
      availableAt: escalationAt,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { ...payload, created: !existing.exists };
};

export const updateKyrubDeliveryStatus = async (
  deliveryId: string,
  status: DeliveryOperationalStatus,
  actor: AuthenticatedActor
): Promise<void> => {
  const normalizedId = validateDeliveryId(deliveryId);
  const deliveryReference = adminDb.doc(deliveryPath(normalizedId));
  const claimReference = adminDb.doc(claimPath(normalizedId));
  const scheduleReference = adminDb.doc(escalationQueuePath(normalizedId));

  await adminDb.runTransaction(async transaction => {
    const [deliverySnapshot, claimSnapshot, scheduleSnapshot] = await Promise.all([
      transaction.get(deliveryReference),
      transaction.get(claimReference),
      transaction.get(scheduleReference),
    ]);
    if (!deliverySnapshot.exists) {
      throw new Error('Esta entrega não foi encontrada.');
    }

    const delivery = deliverySnapshot.data() as Record<string, unknown>;
    const currentStatus = clean(delivery.status);
    const claim = claimSnapshot.data() as Record<string, unknown> | undefined;
    const courierId = clean(claim?.courierId);

    if (status === 'accepted') {
      if (claimSnapshot.exists) {
        if (courierId === actor.uid) return;
        throw new Error('Outro entregador já aceitou esta oportunidade.');
      }
      if (currentStatus !== 'available') {
        throw new Error('Esta entrega já foi aceita.');
      }

      transaction.create(claimReference, {
        id: normalizedId,
        deliveryJobId: normalizedId,
        courierId: actor.uid,
        courierName: actor.name,
        status: 'accepted',
        acceptedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(deliveryReference, {
        status: 'accepted',
        acceptedBy: actor.uid,
        acceptedByName: actor.name,
        acceptedAt: FieldValue.serverTimestamp(),
        fallbackStatus: 'accepted_by_kyrub',
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (scheduleSnapshot.exists) {
        transaction.update(scheduleReference, {
          status: 'cancelled',
          cancelledReason: 'accepted_by_kyrub',
          acceptedBy: actor.uid,
          availableAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return;
    }

    if (!claimSnapshot.exists || courierId !== actor.uid) {
      throw new Error('Somente o entregador responsável pode atualizar a entrega.');
    }

    if (status === 'delivering') {
      if (currentStatus === 'delivering') return;
      if (clean(delivery.source) === 'kyrub-order') {
        throw new Error('Confirme a coleta segura antes de iniciar a rota.');
      }
      if (currentStatus !== 'accepted') {
        throw new Error('A entrega precisa estar aceita antes da coleta.');
      }
      transaction.update(claimReference, {
        status: 'delivering',
        collectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.update(deliveryReference, {
        status: 'delivering',
        collectedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    if (currentStatus === 'done') return;
    if (clean(delivery.source) === 'kyrub-order') {
      throw new Error('A conclusão da entrega Kyrub depende da confirmação do cliente.');
    }
    if (currentStatus !== 'delivering') {
      throw new Error('Confirme a coleta antes de concluir a entrega.');
    }
    transaction.update(claimReference, {
      status: 'done',
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.update(deliveryReference, {
      status: 'done',
      deliveredAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });
};

export const escalateUnacceptedKyrubDeliveries = async (): Promise<{
  checked: number;
  escalated: number;
  cancelled: number;
}> => {
  const snapshot = await adminDb
    .collection(DELIVERY_ESCALATION_QUEUE)
    .where('availableAt', '<=', Timestamp.now())
    .orderBy('availableAt', 'asc')
    .limit(250)
    .get();
  let checked = 0;
  let escalated = 0;
  let cancelled = 0;

  for (const scheduleDocument of snapshot.docs) {
    checked += 1;
    const didEscalate = await adminDb.runTransaction(async transaction => {
      const scheduleReference = scheduleDocument.ref;
      const deliveryReference = adminDb.doc(deliveryPath(scheduleDocument.id));
      const claimReference = adminDb.doc(claimPath(scheduleDocument.id));
      const [scheduleSnapshot, deliverySnapshot, claimSnapshot] = await Promise.all([
        transaction.get(scheduleReference),
        transaction.get(deliveryReference),
        transaction.get(claimReference),
      ]);
      const schedule = scheduleSnapshot.data() as Record<string, unknown> | undefined;
      if (!scheduleSnapshot.exists || clean(schedule?.status) !== 'waiting') {
        return 'ignored' as const;
      }

      if (claimSnapshot.exists) {
        transaction.update(scheduleReference, {
          status: 'cancelled',
          cancelledReason: 'accepted_by_kyrub',
          availableAt: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        return 'cancelled' as const;
      }

      const delivery = deliverySnapshot.data() as Record<string, unknown> | undefined;
      const escalationReference = adminDb.doc(
        `${ESCALATION_COLLECTION}/${scheduleDocument.id}`
      );
      transaction.set(
        escalationReference,
        {
          id: scheduleDocument.id,
          deliveryJobId: scheduleDocument.id,
          sourceOrderId: clean(schedule?.sourceOrderId) || clean(delivery?.sourceOrderId),
          storeId: clean(schedule?.storeId) || clean(delivery?.storeId),
          status: 'awaiting_provider_routing',
          controlPlane: 'admin.kyrub.com',
          providerCandidates: [],
          reason: 'Nenhum entregador Kyrub aceitou em até 3 minutos.',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      transaction.update(scheduleReference, {
        status: 'escalated',
        availableAt: FieldValue.delete(),
        escalatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (deliverySnapshot.exists) {
        transaction.update(deliveryReference, {
          fallbackStatus: 'queued_for_admin_logistics',
          fallbackQueuedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
      }
      return 'escalated' as const;
    });

    if (didEscalate === 'escalated') escalated += 1;
    if (didEscalate === 'cancelled') cancelled += 1;
  }

  return { checked, escalated, cancelled };
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

  router.get('/earnings', async (request, response) => {
    try {
      const courierId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await loadCourierEarningsProjection(courierId));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.get('/:deliveryId/pickup-code', async (request, response) => {
    try {
      const storeId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await readOrCreateDeliveryPickupCodeForStore({
        deliveryId: request.params.deliveryId,
        storeId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/secure-pickup', async (request, response) => {
    try {
      const actor = await authenticatedActor(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      const pickupResult = await confirmSecureCourierPickupAndStartRoute({
        deliveryId: request.params.deliveryId,
        courierId: actor.uid,
        handoffCode: clean(request.body?.handoffCode),
      });
      try {
        await materializeDeliveryResponsibilityAndWaitingDecision({
          deliveryId: request.params.deliveryId,
        });
      } catch (orchestrationError) {
        console.error('[Delivery Responsibility Orchestrator]', orchestrationError);
      }
      response.json(pickupResult);
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/customer-arrival', async (request, response) => {
    try {
      const actor = await authenticatedActor(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await markCourierArrivedAtCustomer({
        deliveryId: request.params.deliveryId,
        courierId: actor.uid,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/buyer-confirmation', async (request, response) => {
    try {
      const buyerId = await authenticatedTenantId(request);
      response.setHeader('Cache-Control', 'no-store, max-age=0');
      response.json(await confirmBuyerReceivedDelivery({
        deliveryId: request.params.deliveryId,
        buyerId,
      }));
    } catch (error) {
      errorResponse(response, error);
    }
  });

  router.post('/:deliveryId/status', async (request, response) => {
    try {
      const actor = await authenticatedActor(request);
      const status = parseOperationalStatus(request.body?.status);
      await updateKyrubDeliveryStatus(request.params.deliveryId, status, actor);
      response.status(204).end();
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
