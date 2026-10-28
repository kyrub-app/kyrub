import { randomBytes, createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
import { applyNinetyNineFoodInboundStatusWithAuthority } from '../inventory/ninetyNineFoodInboundStatusAuthorityService';
import {
  OpenDeliveryClient,
  buildOpenDeliveryAction,
  mapOpenDeliveryEventToOrderStatus,
  normalizeIntegrationBaseUrl,
  normalizeOpenDeliveryOrder,
  parseOpenDeliveryEvent,
  type NormalizedIntegrationOrder,
  type OpenDeliveryConnectionRuntime,
  type OpenDeliveryCredentials,
  type OpenDeliveryEvent,
} from './openDelivery';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret,
  getIntegrationMasterKey,
  integrationLookupId,
  verifyOpenDeliverySignature,
  type EncryptedSecretEnvelope,
} from './secretVault';

const PROVIDER = '99food' as const;
const CONNECTION_COLLECTION = 'integrationConnections';
const LOOKUP_COLLECTION = 'integrationConnectionLookup';
const EVENT_LEASE_MS = 2 * 60 * 1000;

export interface NinetyNineFoodConnectInput {
  externalStoreId: string;
  accountLabel: string;
  routingTarget: string;
  environment: 'sandbox' | 'production';
  baseUrl: string;
  tokenUrl?: string;
  clientId: string;
  clientSecret: string;
}

interface StoredCredentials extends OpenDeliveryCredentials {
  merchantApiKey: string;
}

interface NinetyNineFoodConnectionDocument {
  provider: typeof PROVIDER;
  tenantId: string;
  externalStoreId: string;
  accountLabel: string;
  routingTarget: string;
  environment: 'sandbox' | 'production';
  baseUrl: string;
  tokenUrl: string;
  webhookUrl: string;
  status: 'connected' | 'attention' | 'disabled';
  encryptedCredentials: EncryptedSecretEnvelope;
  lastError: string;
  lastVerifiedAt?: unknown;
  lastWebhookAt?: unknown;
  lastPollAt?: unknown;
  lastPollError?: string;
  lastPollFailedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface NinetyNineFoodPublicStatus {
  configured: boolean;
  provider: typeof PROVIDER;
  status: 'not-configured' | 'connected' | 'attention' | 'disabled';
  externalStoreId: string;
  accountLabel: string;
  routingTarget: string;
  environment: 'sandbox' | 'production';
  baseUrl: string;
  webhookUrl: string;
  lastError: string;
  lastVerifiedAt: string;
  lastWebhookAt: string;
  lastPollAt: string;
  lastPollError: string;
  lastPollFailedAt: string;
}

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const connectionId = (tenantId: string): string => `${tenantId}__${PROVIDER}`;
const connectionPath = (tenantId: string): string =>
  `${CONNECTION_COLLECTION}/${connectionId(tenantId)}`;
const lookupPath = (externalStoreId: string): string =>
  `${LOOKUP_COLLECTION}/${integrationLookupId(PROVIDER, externalStoreId)}`;
const secretAad = (tenantId: string): string => `${PROVIDER}:${tenantId}`;
const eventDocumentId = (eventId: string): string =>
  `${PROVIDER}-${createHash('sha256').update(eventId).digest('hex')}`;
const internalOrderId = (externalOrderId: string): string =>
  `99food-${externalOrderId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

const timestampToIso = (value: unknown): string => {
  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return '';
};

const publicStatus = (
  document: NinetyNineFoodConnectionDocument | null
): NinetyNineFoodPublicStatus => {
  if (!document) {
    return {
      configured: false,
      provider: PROVIDER,
      status: 'not-configured',
      externalStoreId: '',
      accountLabel: '',
      routingTarget: '',
      environment: 'sandbox',
      baseUrl: '',
      webhookUrl: '',
      lastError: '',
      lastVerifiedAt: '',
      lastWebhookAt: '',
      lastPollAt: '',
      lastPollError: '',
      lastPollFailedAt: '',
    };
  }

  return {
    configured: true,
    provider: PROVIDER,
    status: document.status,
    externalStoreId: document.externalStoreId,
    accountLabel: document.accountLabel,
    routingTarget: document.routingTarget,
    environment: document.environment,
    baseUrl: document.baseUrl,
    webhookUrl: document.webhookUrl,
    lastError: document.lastError,
    lastVerifiedAt: timestampToIso(document.lastVerifiedAt),
    lastWebhookAt: timestampToIso(document.lastWebhookAt),
    lastPollAt: timestampToIso(document.lastPollAt),
    lastPollError: clean(document.lastPollError),
    lastPollFailedAt: timestampToIso(document.lastPollFailedAt),
  };
};

const parseConnectionDocument = (
  value: unknown
): NinetyNineFoodConnectionDocument | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.provider !== PROVIDER ||
    !clean(candidate.tenantId) ||
    !clean(candidate.externalStoreId) ||
    !clean(candidate.baseUrl) ||
    !clean(candidate.tokenUrl) ||
    !candidate.encryptedCredentials ||
    typeof candidate.encryptedCredentials !== 'object'
  ) {
    return null;
  }

  return candidate as unknown as NinetyNineFoodConnectionDocument;
};

const loadConnectionDocument = async (
  tenantId: string
): Promise<NinetyNineFoodConnectionDocument | null> => {
  const snapshot = await adminDb.doc(connectionPath(tenantId)).get();
  return parseConnectionDocument(snapshot.data());
};

const connectionRuntime = (
  document: NinetyNineFoodConnectionDocument
): OpenDeliveryConnectionRuntime => {
  const credentials = decryptIntegrationSecret<StoredCredentials>(
    document.encryptedCredentials,
    getIntegrationMasterKey(),
    secretAad(document.tenantId)
  );

  return {
    connectionId: connectionId(document.tenantId),
    tenantId: document.tenantId,
    externalStoreId: document.externalStoreId,
    baseUrl: document.baseUrl,
    tokenUrl: document.tokenUrl,
    routingTarget: document.routingTarget,
    credentials,
  };
};

const validateConnectInput = (
  input: NinetyNineFoodConnectInput
): NinetyNineFoodConnectInput => {
  const externalStoreId = clean(input.externalStoreId);
  const accountLabel = clean(input.accountLabel);
  const routingTarget = clean(input.routingTarget).toLocaleUpperCase('pt-BR');
  const clientId = clean(input.clientId);
  const clientSecret = clean(input.clientSecret);
  const allowInsecure =
    process.env.NODE_ENV !== 'production' &&
    process.env.ALLOW_INSECURE_INTEGRATION_URLS === 'true';
  const baseUrl = normalizeIntegrationBaseUrl(input.baseUrl, allowInsecure);
  const tokenUrl = input.tokenUrl
    ? normalizeIntegrationBaseUrl(input.tokenUrl, allowInsecure)
    : new URL('/oauth/token', `${baseUrl}/`).toString();

  if (!externalStoreId) throw new Error('Informe o Merchant ID da 99Food.');
  if (!accountLabel) throw new Error('Informe o nome da unidade na 99Food.');
  if (!routingTarget) throw new Error('Informe o destino dos pedidos no Kyrub.');
  if (!clientId || !clientSecret) {
    throw new Error('Informe o clientId e o clientSecret emitidos pela 99Food.');
  }
  if (clientId.length > 500 || clientSecret.length > 2_000) {
    throw new Error('As credenciais informadas excedem o tamanho permitido.');
  }

  return {
    externalStoreId,
    accountLabel,
    routingTarget,
    environment: input.environment === 'production' ? 'production' : 'sandbox',
    baseUrl,
    tokenUrl,
    clientId,
    clientSecret,
  };
};

export const connectNinetyNineFood = async (
  tenantId: string,
  input: NinetyNineFoodConnectInput,
  publicAppUrl: string
): Promise<NinetyNineFoodPublicStatus> => {
  const normalized = validateConnectInput(input);
  const webhookUrl = new URL(
    '/api/integrations/99food/v1/newEvent',
    `${publicAppUrl.replace(/\/$/, '')}/`
  ).toString();
  const credentials: StoredCredentials = {
    clientId: normalized.clientId,
    clientSecret: normalized.clientSecret,
    merchantApiKey: randomBytes(32).toString('base64url'),
  };
  const runtime: OpenDeliveryConnectionRuntime = {
    connectionId: connectionId(tenantId),
    tenantId,
    externalStoreId: normalized.externalStoreId,
    baseUrl: normalized.baseUrl,
    tokenUrl: normalized.tokenUrl || '',
    routingTarget: normalized.routingTarget,
    credentials,
  };
  const client = new OpenDeliveryClient(runtime);

  await client.verify();

  let status: NinetyNineFoodConnectionDocument['status'] = 'connected';
  let lastError = '';
  try {
    await client.registerWebhook(webhookUrl);
  } catch (error) {
    status = 'attention';
    lastError = error instanceof Error ? error.message : String(error);
  }

  const now = FieldValue.serverTimestamp();
  const encryptedCredentials = encryptIntegrationSecret(
    credentials,
    getIntegrationMasterKey(),
    secretAad(tenantId)
  );
  const connectionReference = adminDb.doc(connectionPath(tenantId));
  const lookupReference = adminDb.doc(lookupPath(normalized.externalStoreId));
  const existing = await connectionReference.get();
  const previousConnection = parseConnectionDocument(existing.data());
  const batch = adminDb.batch();

  if (
    previousConnection &&
    previousConnection.externalStoreId !== normalized.externalStoreId
  ) {
    batch.delete(adminDb.doc(lookupPath(previousConnection.externalStoreId)));
  }

  batch.set(
    connectionReference,
    {
      provider: PROVIDER,
      tenantId,
      externalStoreId: normalized.externalStoreId,
      accountLabel: normalized.accountLabel,
      routingTarget: normalized.routingTarget,
      environment: normalized.environment,
      baseUrl: normalized.baseUrl,
      tokenUrl: normalized.tokenUrl,
      webhookUrl,
      status,
      encryptedCredentials,
      lastError,
      lastVerifiedAt: now,
      updatedAt: now,
      ...(existing.exists ? {} : { createdAt: now }),
    },
    { merge: true }
  );
  batch.set(lookupReference, {
    provider: PROVIDER,
    tenantId,
    connectionId: connectionId(tenantId),
    externalStoreId: normalized.externalStoreId,
    updatedAt: now,
  });
  await batch.commit();

  return publicStatus(await loadConnectionDocument(tenantId));
};

export const getNinetyNineFoodStatus = async (
  tenantId: string
): Promise<NinetyNineFoodPublicStatus> =>
  publicStatus(await loadConnectionDocument(tenantId));

export const disconnectNinetyNineFood = async (
  tenantId: string
): Promise<void> => {
  const current = await loadConnectionDocument(tenantId);
  if (!current) return;
  const batch = adminDb.batch();
  batch.delete(adminDb.doc(connectionPath(tenantId)));
  batch.delete(adminDb.doc(lookupPath(current.externalStoreId)));
  await batch.commit();
};

const resolveConnectionForWebhook = async (
  externalStoreId: string
): Promise<NinetyNineFoodConnectionDocument> => {
  const lookup = await adminDb.doc(lookupPath(externalStoreId)).get();
  const tenantId = clean(lookup.data()?.tenantId);
  if (!tenantId) throw new Error('Merchant 99Food não está vinculado ao Kyrub.');
  const connection = await loadConnectionDocument(tenantId);
  if (!connection || connection.externalStoreId !== externalStoreId) {
    throw new Error('Conexão 99Food inconsistente.');
  }
  return connection;
};

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  const id = clean(tenant.data()?.canonicalStoreId);
  if (!id || id.includes('/')) {
    throw new Error('Loja sem identidade canônica configurada.');
  }
  return id;
};

const canonicalOrder = (
  order: NormalizedIntegrationOrder,
  canonicalStoreId: string,
  tenantId: string
): Record<string, unknown> => ({
  ...order,
  storeId: canonicalStoreId,
  legacyStoreId: tenantId,
  createdByUserId: 'integration:99food',
  createdByRole: 'integration',
  // An external preparation state is evidence from the provider, not a
  // license to start KDS production without confirmed settlement.
  ...(order.paymentStatus !== 'paid' &&
    !order.integration.paymentEvidence?.payOnDelivery &&
    ['preparing', 'ready', 'out_for_delivery', 'completed'].includes(order.status)
    ? {
        status: 'pending',
        integration: {
          ...order.integration,
          paymentGateBlockedStatus: order.status,
          paymentGateBlockedAt: new Date().toISOString(),
        },
      }
    : {}),
});

const persistNormalizedOrder = async (
  tenantId: string,
  order: NormalizedIntegrationOrder,
  eventReferencePath: string,
  eventAttemptId: string,
  eventId: string,
  externalOrderId: string
): Promise<void> => {
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const reference = adminDb.doc(`stores/${canonicalStoreId}/orders/${order.id}`);
  const eventReference = adminDb.doc(eventReferencePath);
  await adminDb.runTransaction(async transaction => {
    const [existing, eventSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(eventReference),
    ]);
    const reserved = eventSnapshot.data();
    const lease = reserved?.leaseExpiresAt;
    if (reserved?.status !== 'processing' ||
        reserved?.attemptId !== eventAttemptId ||
        reserved?.eventId !== eventId ||
        reserved?.externalOrderId !== externalOrderId ||
        !(lease instanceof Timestamp) || lease.toMillis() <= Date.now()) {
      throw new Error('NINETY_NINE_FOOD_EVENT_RESERVATION_LOST');
    }
    if (existing.exists) return;
    transaction.create(reference, canonicalOrder(order, canonicalStoreId, tenantId));
  });
};

const updatePersistedOrderStatus = async (
  tenantId: string,
  externalOrderId: string,
  status: NormalizedIntegrationOrder['status'],
  lastEvent: string
): Promise<void> => {
  const orderId = internalOrderId(externalOrderId);
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  await adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`).update({
    status,
    updatedAt: new Date().toISOString(),
    'integration.lastEvent': lastEvent,
  });
};

const reserveEvent = async (
  connection: NinetyNineFoodConnectionDocument,
  event: OpenDeliveryEvent
): Promise<{ reserved: boolean; alreadyProcessed: boolean; referencePath: string; attemptId: string }> => {
  const referencePath =
    `tenants/${connection.tenantId}/integrationEvents/${eventDocumentId(event.eventId)}`;
  const reference = adminDb.doc(referencePath);
  const attemptId = randomBytes(16).toString('hex');
  const decision = await adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    const existing = snapshot.data() as Record<string, unknown> | undefined;
    const status = clean(existing?.status);
    const lease = existing?.leaseExpiresAt;
    const leaseActive =
      lease instanceof Timestamp && lease.toMillis() > Date.now();

    if (status === 'processed') return 'processed' as const;
    if (status === 'processing' && leaseActive) return 'busy' as const;

    transaction.set(
      reference,
      {
        provider: PROVIDER,
        tenantId: connection.tenantId,
        eventId: event.eventId,
        eventType: event.eventType,
        externalOrderId: event.orderId,
        status: 'processing',
        attemptId,
        attempts: FieldValue.increment(1),
        receivedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: Timestamp.fromMillis(Date.now() + EVENT_LEASE_MS),
        error: FieldValue.delete(),
      },
      { merge: true }
    );
    return 'reserved' as const;
  });

  return { reserved: decision === 'reserved', alreadyProcessed: decision === 'processed', referencePath, attemptId };
};

/** A timed-out worker must never finalize another worker's reservation. */
const finalizeReservedEvent = async (
  tenantId: string,
  referencePath: string,
  attemptId: string,
  outcome: 'processed' | 'failed',
  error = ''
): Promise<boolean> => adminDb.runTransaction(async transaction => {
  const reference = adminDb.doc(referencePath);
  const connectionReference = adminDb.doc(connectionPath(tenantId));
  const [snapshot, connectionSnapshot] = await Promise.all([
    transaction.get(reference),
    transaction.get(connectionReference),
  ]);
  const data = snapshot.data();
  const lease = data?.leaseExpiresAt;
  if (data?.status !== 'processing' || data.attemptId !== attemptId ||
      !(lease instanceof Timestamp) || lease.toMillis() <= Date.now()) return false;
  const connection = connectionSnapshot.data();
  // Serialize health changes with event finalization. A later failure must not
  // replace a connection already recovered by a successful event.
  const observedAt = Timestamp.now();
  // A failed event must remain visible even when another event succeeded.
  // The connection status is the latest committed finalization, serialized
  // with the event record in this transaction.
  transaction.update(reference, outcome === 'processed'
    ? {
        status: 'processed',
        processedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
        attemptId: FieldValue.delete(),
      }
    : {
        status: 'failed',
        error: error.slice(0, 1_000),
        failedAt: FieldValue.serverTimestamp(),
        leaseExpiresAt: FieldValue.delete(),
        attemptId: FieldValue.delete(),
      });
  if (outcome === 'processed') {
    transaction.set(connectionReference, {
      status: 'connected',
      lastWebhookAt: observedAt,
      lastError: '',
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    transaction.set(connectionReference, {
      status: 'attention',
      lastError: error.slice(0, 1_000),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  return true;
});

export const processNinetyNineFoodEvent = async (
  connection: NinetyNineFoodConnectionDocument,
  eventValue: unknown
): Promise<{ duplicate: boolean; event: OpenDeliveryEvent }> => {
  const event = parseOpenDeliveryEvent(eventValue);
  const reservation = await reserveEvent(connection, event);
  if (!reservation.reserved) {
    if (reservation.alreadyProcessed) return { duplicate: true, event };
    throw new Error('NINETY_NINE_FOOD_EVENT_ALREADY_PROCESSING');
  }

  try {
    const canonicalStoreId = await canonicalStoreIdForTenant(connection.tenantId);
    const currentOrder = await adminDb.doc(
      `stores/${canonicalStoreId}/orders/${internalOrderId(event.orderId)}`
    ).get();
    const status = mapOpenDeliveryEventToOrderStatus(event.eventType);

    if (!currentOrder.exists) {
      const client = new OpenDeliveryClient(connectionRuntime(connection));
      const details = await client.getOrder(event);
      const order = normalizeOpenDeliveryOrder(details, {
        tenantId: connection.tenantId,
        routingTarget: connection.routingTarget,
        sourceAppId: event.sourceAppId,
      });
      if (order.integration.externalOrderId !== event.orderId) {
        throw new Error('NINETY_NINE_FOOD_PAYMENT_ORDER_MISMATCH');
      }
      await persistNormalizedOrder(
        connection.tenantId, order, reservation.referencePath,
        reservation.attemptId, event.eventId, event.orderId
      );
    } else {
      // Refresh financial evidence for existing orders; status-only webhooks
      // must not be treated as payment confirmation.
      const client = new OpenDeliveryClient(connectionRuntime(connection));
      const details = await client.getOrder(event);
      const normalized = normalizeOpenDeliveryOrder(details, {
        tenantId: connection.tenantId,
        routingTarget: connection.routingTarget,
        sourceAppId: event.sourceAppId,
      });
      if (normalized.integration.externalOrderId !== event.orderId) {
        throw new Error('NINETY_NINE_FOOD_PAYMENT_ORDER_MISMATCH');
      }
      await applyNinetyNineFoodInboundStatusWithAuthority({
        providerPayment: {
          externalOrderId: normalized.integration.externalOrderId,
          paymentStatus: normalized.paymentStatus,
          payOnDelivery: normalized.integration.paymentEvidence?.payOnDelivery === true,
        },
        tenantId: connection.tenantId,
        externalOrderId: event.orderId,
        eventId: event.eventId,
        eventType: event.eventType,
        eventReferencePath: reservation.referencePath,
        eventAttemptId: reservation.attemptId,
        mappedStatus: event.eventType === 'CREATED' ? null : status,
      });
    }

    const finalized = await finalizeReservedEvent(
      connection.tenantId, reservation.referencePath, reservation.attemptId, 'processed'
    );
    if (!finalized) {
      // Another worker owns the lease; do not acknowledge or overwrite its result.
      throw new Error('NINETY_NINE_FOOD_EVENT_RESERVATION_LOST');
    }
    return { duplicate: false, event };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finalizeReservedEvent(
      connection.tenantId, reservation.referencePath, reservation.attemptId, 'failed', message
    ).catch(finalizationError => {
      console.error('[99Food] Could not finalize failed event reservation.', finalizationError);
      return false;
    });
    throw error;
  }
};

export const receiveNinetyNineFoodWebhook = async (input: {
  externalStoreId: string;
  signature: string;
  rawBody: Buffer;
  payload: unknown;
}): Promise<{ duplicate: boolean; event: OpenDeliveryEvent }> => {
  if (!input.externalStoreId || !input.signature) {
    throw new Error('Cabeçalhos Open Delivery obrigatórios não foram informados.');
  }
  const connection = await resolveConnectionForWebhook(input.externalStoreId);
  const credentials = decryptIntegrationSecret<StoredCredentials>(
    connection.encryptedCredentials,
    getIntegrationMasterKey(),
    secretAad(connection.tenantId)
  );
  if (
    !verifyOpenDeliverySignature(
      input.rawBody,
      credentials.clientSecret,
      input.signature
    )
  ) {
    throw new Error('Assinatura HMAC da 99Food é inválida.');
  }
  return processNinetyNineFoodEvent(connection, input.payload);
};

export const pollNinetyNineFood = async (
  tenantId: string
): Promise<{ received: number; processed: number; failed: number }> => {
  const connection = await loadConnectionDocument(tenantId);
  if (!connection || connection.status === 'disabled') {
    throw new Error('A integração 99Food não está configurada.');
  }
  const client = new OpenDeliveryClient(connectionRuntime(connection));
  const events = await client.pollEvents();
  const acknowledged: OpenDeliveryEvent[] = [];
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    try {
      const result = await processNinetyNineFoodEvent(connection, event);
      acknowledged.push(event);
      if (!result.duplicate) processed += 1;
    } catch (error) {
      failed += 1;
    }
  }

  await client.acknowledgeEvents(acknowledged);
  // Polling records its own observation time; event finalization alone owns
  // connection health, so a delayed poll cannot overwrite a newer result.
  await adminDb.doc(connectionPath(tenantId)).set(
    {
      lastPollAt: FieldValue.serverTimestamp(),
      lastPollError: '',
    },
    { merge: true }
  );
  return { received: events.length, processed, failed };
};

export const pollAllNinetyNineFoodConnections = async (): Promise<{
  checked: number;
  processed: number;
  failures: number;
}> => {
  const snapshot = await adminDb
    .collection(CONNECTION_COLLECTION)
    .where('provider', '==', PROVIDER)
    .get();
  let checked = 0;
  let processed = 0;
  let failures = 0;

  for (const document of snapshot.docs) {
    const connection = parseConnectionDocument(document.data());
    if (!connection || connection.status === 'disabled') continue;
    checked += 1;
    try {
      const result = await pollNinetyNineFood(connection.tenantId);
      processed += result.processed;
      failures += result.failed;
    } catch (error) {
      failures += 1;
      // Poll transport errors are distinct from event-processing failures.
      // Keep their evidence without racing the event finalizer's health state.
      await document.ref.set(
        {
          lastPollError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
          lastPollFailedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  return { checked, processed, failures };
};

export const sendNinetyNineFoodOrderStatus = async (
  tenantId: string,
  externalOrderId: string,
  nextStatus: NormalizedIntegrationOrder['status'],
  reason = ''
): Promise<void> => {
  const connection = await loadConnectionDocument(tenantId);
  if (!connection || connection.status === 'disabled') {
    throw new Error('A integração 99Food não está configurada.');
  }
  const orderId = internalOrderId(externalOrderId);
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const snapshot = await adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`).get();
  const data = snapshot.data();
  if (!data) throw new Error('Pedido 99Food não encontrado no Kyrub.');
  const integration = data.integration as Record<string, unknown> | undefined;
  const action = buildOpenDeliveryAction(externalOrderId, nextStatus, {
    displayId: clean(integration?.displayId) || externalOrderId,
    createdAt: clean(data.createdAt) || new Date().toISOString(),
    reason,
  });
  const client = new OpenDeliveryClient(connectionRuntime(connection));
  // Only transmit the partner action. The caller owns the authoritative
  // order/execution transaction and must decide whether it can finalize.
  await client.sendAction(action);
};