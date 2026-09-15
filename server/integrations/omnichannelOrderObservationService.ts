import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown, max = 1_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, max)
    : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const stringList = (value: unknown, max = 240): string[] =>
  Array.isArray(value)
    ? Array.from(new Set(value.map(item => clean(item, max)).filter(Boolean))).sort()
    : [];

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const timestampToIso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return clean(value, 120);
};

const firstTimestamp = (...values: unknown[]): string => {
  for (const value of values) {
    const parsed = timestampToIso(value);
    if (parsed) return parsed;
  }
  return '';
};

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const canonicalStoreId = clean(tenant.data()?.canonicalStoreId, 160);
  if (!canonicalStoreId) {
    throw new Error('OMNICHANNEL_ORDER_OBSERVATION_CANONICAL_STORE_REQUIRED');
  }
  return canonicalStoreId;
};

export type OmnichannelObservedProvider = '99food' | 'mercado_livre';
export type OmnichannelIngressState =
  | 'queued'
  | 'pending'
  | 'processing'
  | 'processed'
  | 'failed'
  | 'unobserved';
export type OmnichannelBindingState = 'resolved' | 'blocked' | 'unobserved';
export type OmnichannelKdsState = 'routed' | 'blocked' | 'not_routed' | 'unobserved';
export type OmnichannelDivergenceState = 'open' | 'none' | 'unobserved';

export type OmnichannelObservedReservationState =
  | 'reserved'
  | 'released'
  | 'consumed'
  | 'waiting_physical_consumption'
  | 'not_applicable'
  | 'blocked_product_binding_unresolved'
  | 'blocked_insufficient_atp'
  | 'blocked_authority_unresolved'
  | 'unobserved';

const RESERVATION_STATES = new Set<OmnichannelObservedReservationState>([
  'reserved',
  'released',
  'consumed',
  'waiting_physical_consumption',
  'not_applicable',
  'blocked_product_binding_unresolved',
  'blocked_insufficient_atp',
  'blocked_authority_unresolved',
]);

const reservationState = (
  reservation: Record<string, unknown>
): OmnichannelObservedReservationState => {
  const state = clean(reservation.state, 120) as OmnichannelObservedReservationState;
  return RESERVATION_STATES.has(state) ? state : 'unobserved';
};

export interface OmnichannelOrderTimelineEvidence {
  stage:
    | 'ingress'
    | 'provider_event'
    | 'provider_refetch'
    | 'binding'
    | 'canonical_order'
    | 'kds'
    | 'inventory'
    | 'divergence';
  status: string;
  at: string;
  evidenceId: string;
  detail: string;
}

export interface OmnichannelObservedOrder {
  provider: OmnichannelObservedProvider;
  externalOrderId: string;
  orderId: string;
  displayId: string;
  customerName: string;
  orderStatus: string;
  providerStatus: string;
  lastProviderEvent: string;
  createdAt: string;
  updatedAt: string;
  ingress: {
    state: OmnichannelIngressState;
    evidenceId: string;
    attempts: number | null;
    error: string;
    outcome: string;
  };
  binding: {
    state: OmnichannelBindingState;
    missingExternalItemIds: string[];
    unresolvedExternalProductIds: string[];
  };
  kds: {
    state: OmnichannelKdsState;
    routingTarget: string;
  };
  inventory: {
    state: OmnichannelObservedReservationState;
    detail: string;
    canonicalProductIds: string[];
    unresolvedExternalProductIds: string[];
    inventoryItemId: string;
    requiredQuantity: number | null;
    availableQuantity: number | null;
    reconciledAt: string;
  };
  divergence: {
    state: OmnichannelDivergenceState;
    evidenceIds: string[];
    kinds: string[];
  };
  timeline: OmnichannelOrderTimelineEvidence[];
}

interface MutableObservation extends OmnichannelObservedOrder {
  rankAt: string;
}

const observationKey = (
  provider: OmnichannelObservedProvider,
  externalOrderId: string
): string => `${provider}:${externalOrderId}`;

const emptyObservation = (
  provider: OmnichannelObservedProvider,
  externalOrderId: string
): MutableObservation => ({
  provider,
  externalOrderId,
  orderId: provider === 'mercado_livre'
    ? `mercado-livre-order-${externalOrderId}`
    : `99food-${externalOrderId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
  displayId: externalOrderId,
  customerName: '',
  orderStatus: '',
  providerStatus: '',
  lastProviderEvent: '',
  createdAt: '',
  updatedAt: '',
  ingress: {
    state: 'unobserved',
    evidenceId: '',
    attempts: null,
    error: '',
    outcome: '',
  },
  binding: {
    state: 'unobserved',
    missingExternalItemIds: [],
    unresolvedExternalProductIds: [],
  },
  kds: {
    state: 'unobserved',
    routingTarget: '',
  },
  inventory: {
    state: 'unobserved',
    detail: '',
    canonicalProductIds: [],
    unresolvedExternalProductIds: [],
    inventoryItemId: '',
    requiredQuantity: null,
    availableQuantity: null,
    reconciledAt: '',
  },
  divergence: {
    state: 'unobserved',
    evidenceIds: [],
    kinds: [],
  },
  timeline: [],
  rankAt: '',
});

const upsertObservation = (
  observations: Map<string, MutableObservation>,
  provider: OmnichannelObservedProvider,
  externalOrderId: string
): MutableObservation => {
  const key = observationKey(provider, externalOrderId);
  const current = observations.get(key);
  if (current) return current;
  const created = emptyObservation(provider, externalOrderId);
  observations.set(key, created);
  return created;
};

const addTimeline = (
  observation: MutableObservation,
  evidence: OmnichannelOrderTimelineEvidence
): void => {
  observation.timeline.push(evidence);
  if (evidence.at && evidence.at > observation.rankAt) observation.rankAt = evidence.at;
};

const ingressState99Food = (value: unknown): OmnichannelIngressState => {
  const status = clean(value, 80);
  if (status === 'queued' || status === 'processing' || status === 'processed' || status === 'failed') {
    return status;
  }
  return 'unobserved';
};

const ingressStateMercadoLivre = (value: unknown): OmnichannelIngressState => {
  const status = clean(value, 80);
  if (status === 'pending') return 'pending';
  if (status === 'processed') return 'processed';
  if (status === 'failed') return 'failed';
  return 'unobserved';
};

const mergeStringList = (left: string[], right: string[]): string[] =>
  Array.from(new Set([...left, ...right].filter(Boolean))).sort();

const loadCollectionDocuments = async (paths: string[], limit: number) => {
  const snapshots = await Promise.all(paths.map(path =>
    adminDb.collection(path).limit(limit).get()
  ));
  return snapshots.flatMap(snapshot => snapshot.docs);
};

export const listRecentOmnichannelObservedOrders = async (input: {
  tenantId: string;
  requestedByUserId: string;
  limit?: number;
}): Promise<{
  canonicalStoreId: string;
  observedAt: string;
  items: OmnichannelObservedOrder[];
}> => {
  const tenantId = clean(input.tenantId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!tenantId || tenantId !== requestedByUserId) {
    throw new Error('OMNICHANNEL_ORDER_OBSERVATION_FORBIDDEN');
  }

  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const requestedLimit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.trunc(input.limit)
    : 30;
  const limit = Math.max(1, Math.min(100, requestedLimit));
  const readLimit = Math.max(100, Math.min(500, limit * 10));
  const storePaths = Array.from(new Set([tenantId, canonicalStoreId])).filter(Boolean);

  const [
    ninetyNineIngress,
    ninetyNineEvents,
    mercadoLivreInbox,
    ninetyNineOrders,
    mercadoLivreOrders,
    mercadoLivreBlocks,
    providerDivergences,
    genericDivergences,
  ] = await Promise.all([
    adminDb.collection('integrationIngress').where('tenantId', '==', tenantId).limit(readLimit).get(),
    adminDb.collection(`tenants/${tenantId}/integrationEvents`).limit(readLimit).get(),
    adminDb.collection('integrationWebhookInbox').where('storeId', '==', tenantId).limit(readLimit).get(),
    adminDb.collection(`stores/${canonicalStoreId}/orders`).where('sourceChannel', '==', '99food').limit(readLimit).get(),
    adminDb.collection(`stores/${canonicalStoreId}/orders`).where('sourceChannel', '==', 'mercado_livre').limit(readLimit).get(),
    loadCollectionDocuments(
      storePaths.map(storeId => `stores/${storeId}/mercadoLivreOrderIngressBlocks`),
      readLimit
    ),
    loadCollectionDocuments(
      storePaths.map(storeId => `stores/${storeId}/omnichannelDivergences`),
      readLimit
    ),
    Promise.all(storePaths.map(storeId =>
      adminDb.collection('integrationSyncDivergences').where('storeId', '==', storeId).limit(readLimit).get()
    )),
  ]);

  const observations = new Map<string, MutableObservation>();

  for (const document of ninetyNineIngress.docs) {
    const data = record(document.data());
    if (clean(data.provider, 80) !== '99food') continue;
    const externalOrderId = clean(data.externalOrderId, 240);
    if (!externalOrderId) continue;
    const observation = upsertObservation(observations, '99food', externalOrderId);
    const state = ingressState99Food(data.status);
    const at = firstTimestamp(
      data.processedAt,
      data.failedAt,
      data.updatedAt,
      data.receivedAt
    );
    const currentAt = observation.timeline.find(item => item.stage === 'ingress')?.at ?? '';
    if (!currentAt || at >= currentAt) {
      observation.ingress = {
        state,
        evidenceId: document.id,
        attempts: finiteNumber(data.attempts),
        error: clean(data.error, 1_000),
        outcome: clean(data.eventType, 160),
      };
      observation.lastProviderEvent = clean(data.eventType, 160) || observation.lastProviderEvent;
    }
    addTimeline(observation, {
      stage: 'ingress',
      status: state,
      at,
      evidenceId: document.id,
      detail: clean(data.eventType, 160),
    });
  }

  for (const document of ninetyNineEvents.docs) {
    const data = record(document.data());
    if (clean(data.provider, 80) !== '99food') continue;
    const externalOrderId = clean(data.externalOrderId, 240);
    if (!externalOrderId) continue;
    const observation = upsertObservation(observations, '99food', externalOrderId);
    const at = firstTimestamp(data.processedAt, data.receivedAt, data.updatedAt);
    const eventType = clean(data.eventType, 160);
    if (eventType) observation.lastProviderEvent = eventType;
    addTimeline(observation, {
      stage: 'provider_event',
      status: clean(data.status, 120) || 'observed',
      at,
      evidenceId: clean(data.eventId, 240) || document.id,
      detail: eventType,
    });
  }

  for (const document of mercadoLivreInbox.docs) {
    const data = record(document.data());
    if (clean(data.provider, 80) !== 'mercado_livre' || clean(data.topic, 80) !== 'orders_v2') continue;
    const externalOrderId = clean(data.externalOrderId, 240) || (() => {
      const resource = clean(data.resource, 500);
      const match = /^\/orders\/([^/?#]+)$/.exec(resource);
      return match?.[1] ?? '';
    })();
    if (!externalOrderId) continue;
    const observation = upsertObservation(observations, 'mercado_livre', externalOrderId);
    const state = ingressStateMercadoLivre(data.processingStatus);
    const at = firstTimestamp(data.processedAt, data.receivedAt, data.createdAt, data.updatedAt);
    const outcome = clean(data.processingOutcome, 160);
    observation.ingress = {
      state,
      evidenceId: document.id,
      attempts: null,
      error: clean(data.processingError, 1_000),
      outcome,
    };
    observation.providerStatus = clean(data.providerOrderStatus, 120) || observation.providerStatus;
    addTimeline(observation, {
      stage: 'ingress',
      status: state,
      at,
      evidenceId: document.id,
      detail: outcome || clean(data.topic, 80),
    });
    if (clean(data.processingAuthority, 120) === 'provider_api_refetch') {
      addTimeline(observation, {
        stage: 'provider_refetch',
        status: observation.providerStatus || outcome || 'completed',
        at,
        evidenceId: document.id,
        detail: outcome,
      });
    }
  }

  const ingestCanonicalOrders = (
    provider: OmnichannelObservedProvider,
    documents: typeof ninetyNineOrders.docs
  ): void => {
    for (const document of documents) {
      const order = record(document.data());
      const integration = record(order.integration);
      if (clean(integration.provider, 80) !== provider) continue;
      const externalOrderId = clean(integration.externalOrderId, 240);
      if (!externalOrderId) continue;
      const observation = upsertObservation(observations, provider, externalOrderId);
      observation.orderId = document.id;
      observation.displayId = clean(integration.displayId, 160) || externalOrderId;
      observation.customerName = clean(order.buyerName, 240) || clean(order.customerName, 240);
      observation.orderStatus = clean(order.status, 120);
      observation.providerStatus = clean(integration.providerStatus, 120) || observation.providerStatus;
      observation.lastProviderEvent = clean(integration.lastEvent, 160) || observation.lastProviderEvent;
      observation.createdAt = clean(order.createdAt, 120);
      observation.updatedAt = clean(order.updatedAt, 120);
      const routingTarget = clean(integration.routingTarget, 120);
      observation.kds.routingTarget = routingTarget;
      observation.kds.state = routingTarget.toUpperCase() === 'KDS' ? 'routed' : 'not_routed';

      const reservation = record(order.inventoryReservation);
      observation.inventory = {
        state: reservationState(reservation),
        detail: clean(reservation.detail, 500),
        canonicalProductIds: stringList(reservation.canonicalProductIds),
        unresolvedExternalProductIds: stringList(reservation.unresolvedExternalProductIds),
        inventoryItemId: clean(reservation.inventoryItemId, 240),
        requiredQuantity: finiteNumber(reservation.requiredQuantity),
        availableQuantity: finiteNumber(reservation.availableQuantity),
        reconciledAt: clean(reservation.reconciledAt, 120),
      };
      observation.binding.unresolvedExternalProductIds = observation.inventory.unresolvedExternalProductIds;
      if (observation.inventory.state === 'blocked_product_binding_unresolved') {
        observation.binding.state = 'blocked';
      } else if (
        observation.inventory.canonicalProductIds.length > 0 ||
        provider === 'mercado_livre'
      ) {
        observation.binding.state = 'resolved';
      }

      const orderAt = observation.updatedAt || observation.createdAt;
      addTimeline(observation, {
        stage: 'canonical_order',
        status: observation.orderStatus || 'persisted',
        at: orderAt,
        evidenceId: document.id,
        detail: provider,
      });
      addTimeline(observation, {
        stage: 'kds',
        status: observation.kds.state,
        at: orderAt,
        evidenceId: document.id,
        detail: routingTarget,
      });
      if (observation.inventory.state !== 'unobserved') {
        addTimeline(observation, {
          stage: 'inventory',
          status: observation.inventory.state,
          at: observation.inventory.reconciledAt || orderAt,
          evidenceId: document.id,
          detail: observation.inventory.detail,
        });
      }
    }
  };

  ingestCanonicalOrders('99food', ninetyNineOrders.docs);
  ingestCanonicalOrders('mercado_livre', mercadoLivreOrders.docs);

  for (const document of mercadoLivreBlocks) {
    const data = record(document.data());
    const externalOrderId = clean(data.externalOrderId, 240) ||
      document.id.replace(/^mercado-livre-order-/, '');
    if (!externalOrderId) continue;
    const observation = upsertObservation(observations, 'mercado_livre', externalOrderId);
    const missingExternalItemIds = stringList(data.missingExternalItemIds);
    observation.binding.state = 'blocked';
    observation.binding.missingExternalItemIds = mergeStringList(
      observation.binding.missingExternalItemIds,
      missingExternalItemIds
    );
    if (!observation.orderStatus) observation.kds.state = 'blocked';
    const at = firstTimestamp(data.updatedAt, data.detectedAt, data.createdAt, data.serverDetectedAt);
    addTimeline(observation, {
      stage: 'binding',
      status: 'blocked',
      at,
      evidenceId: document.id,
      detail: clean(data.reason, 500) || 'product_binding_required',
    });
  }

  const attachDivergence = (
    provider: OmnichannelObservedProvider,
    externalOrderId: string,
    evidenceId: string,
    kind: string,
    at: string
  ): void => {
    if (!externalOrderId) return;
    const observation = upsertObservation(observations, provider, externalOrderId);
    observation.divergence.state = 'open';
    observation.divergence.evidenceIds = mergeStringList(
      observation.divergence.evidenceIds,
      [evidenceId]
    );
    observation.divergence.kinds = mergeStringList(
      observation.divergence.kinds,
      [kind || 'conflict']
    );
    addTimeline(observation, {
      stage: 'divergence',
      status: 'open',
      at,
      evidenceId,
      detail: kind || 'conflict',
    });
  };

  for (const document of providerDivergences) {
    const data = record(document.data());
    if (clean(data.provider, 80) !== 'mercado_livre') continue;
    attachDivergence(
      'mercado_livre',
      clean(data.externalOrderId, 240),
      document.id,
      clean(data.kind, 240),
      firstTimestamp(data.detectedAt, data.serverDetectedAt, data.updatedAt)
    );
  }

  for (const snapshot of genericDivergences) {
    for (const document of snapshot.docs) {
      const data = record(document.data());
      if (clean(data.status, 80) && clean(data.status, 80) !== 'open') continue;
      if (clean(data.entityType, 80) && clean(data.entityType, 80) !== 'order') continue;
      const channelId = clean(data.channelId, 80);
      const provider: OmnichannelObservedProvider | null =
        channelId === '99food'
          ? '99food'
          : channelId === 'mercado_livre'
            ? 'mercado_livre'
            : null;
      if (!provider) continue;
      attachDivergence(
        provider,
        clean(data.externalId, 240),
        document.id,
        'sync_conflict',
        firstTimestamp(data.lastSeenAt, data.firstSeenAt)
      );
    }
  }

  for (const observation of observations.values()) {
    if (observation.binding.state === 'unobserved' && observation.orderStatus && observation.provider === '99food') {
      if (observation.inventory.state !== 'unobserved') {
        observation.binding.state = observation.inventory.state === 'blocked_product_binding_unresolved'
          ? 'blocked'
          : 'resolved';
      }
    }
    if (observation.divergence.state === 'unobserved' && observation.orderStatus) {
      observation.divergence.state = 'none';
    }
    observation.timeline.sort((left, right) => {
      if (!left.at && !right.at) return left.stage.localeCompare(right.stage);
      if (!left.at) return 1;
      if (!right.at) return -1;
      return left.at.localeCompare(right.at);
    });
    observation.rankAt = observation.rankAt || observation.updatedAt || observation.createdAt;
  }

  const items = Array.from(observations.values())
    .sort((left, right) => right.rankAt.localeCompare(left.rankAt))
    .slice(0, limit)
    .map(({ rankAt: _rankAt, ...item }) => item);

  return {
    canonicalStoreId,
    observedAt: new Date().toISOString(),
    items,
  };
};
