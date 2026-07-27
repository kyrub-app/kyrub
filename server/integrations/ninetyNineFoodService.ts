import { randomBytes, createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin';
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
const legacyOrderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

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
  const batch = adminDb.batch();
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
  return clean(tenant.data()?.canonicalStoreId);
};

const canonicalOrder = (
  order: NormalizedIntegrationOrder,
  canonicalStoreId: string,
  tenantId: string
): Record<string, unknown> => ({
  ...order,
  storeId: canonicalStoreId,
  legacyStoreId: tenantId,
  migratedFromPath: legacyOrderPath(tenantId, order.id),
  createdByUserId: 'integration:99food',
  createdByRole: 'integration',
  migration: {
    mode: 'integration',
    provider: PROVIDER,
    source: 'open-delivery',
  },
});

const persistNormalizedOrder = async (
  tenantId: string,
  order: NormalizedIntegrationOrder
): Promise<void> => {
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const batch = adminDb.batch();
  batch.set(adminDb.doc(legacyOrderPath(tenantId, order.id)), order, { merge: true });
  if (canonicalStoreId) {
    batch.set(
      adminDb.doc(`stores/${canonicalStoreId}/orders/${order.id}`),
      canonicalOrder(order, canonicalStoreId, tenantId),
      { merge: true }
    );
  }
  await batch.commit();
};

const updatePersistedOrderStatus = async (
  tenantId: string,
  externalOrderId: string,
  status: NormalizedIntegrationOrder['status'],
  lastEvent: string
): Promise<void> => {
  const orderId = internalOrderId(externalOrderId);
  const canonicalStoreId = await canonicalStoreIdForTenant(tenantId);
  const updatedAt = new Date().toISOString();
  const patch = {
    status,
    updatedAt,
    'integration.lastEvent': lastEvent,
  };
  const batch = adminDb.batch();
  batch.update(adminDb.doc(legacyOrderPath(tenantId, orderId)), patch);
  if (canonicalStoreId) {
    batch.update(adminDb.doc(`stores/${canonicalStoreId}/orders/${orderId}`), patch);
  }
  await batch.commit();
};

const eventAlreadyExists = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: string | number };
  return candidate.code === 6 || candidate.code === 'already-exists';
};

export const processNinetyNineFoodEvent = async (
  connection: NinetyNineFoodConnectionDocument,
  eventValue: unknown
): Promise<{ duplicate: boolean; event: OpenDeliveryEvent }> => {
  const event = parseOpenDeliveryEvent(eventValue);
  const eventReference = adminDb.doc(
    `tenants/${connection.tenantId}/integrationEvents/${eventDocumentId(event.eventId)}`
  );

  try {
    await eventReference.create({
      provider: PROVIDER,
      tenantId: connection.tenantId,
      eventId: event.eventId,
      eventType: event.eventType,
      externalOrderId: event.orderId,
      status: 'processing',
      receivedAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    if (eventAlreadyExists(error)) return { duplicate: true, event };
    throw error;
  }

  try {
    const legacyReference = adminDb.doc(
      legacyOrderPath(connection.tenantId, internalOrderId(event.orderId))
    );
    const currentOrder = await legacyReference.get();
    const status = mapOpenDeliveryEventToOrderStatus(event.eventType);

    if (event.eventType === 'CREATED' || !currentOrder.exists) {
      const client = new OpenDeliveryClient(connectionRuntime(connection));
      const details = await client.getOrder(event);
      const order = normalizeOpenDeliveryOrder(details, {
        tenantId: connection.tenantId,
        routingTarget: connection.routingTarget,
        sourceAppId: event.sourceAppId,
      });
      await persistNormalizedOrder(connection.tenantId, order);
    } else if (status) {
      await updatePersistedOrderStatus(
        connection.tenantId,
        event.orderId,
        status,
        event.eventType
      );
    }

    await Promise.all([
      eventReference.update({
        status: 'processed',
        processedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(connectionPath(connection.tenantId)).set(
        {
          lastWebhookAt: FieldValue.serverTimestamp(),
          lastError: '',
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);

    return { duplicate: false, event };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await Promise.allSettled([
      eventReference.update({
        status: 'failed',
        error: message.slice(0, 1_000),
        failedAt: FieldValue.serverTimestamp(),
      }),
      adminDb.doc(connectionPath(connection.tenantId)).set(
        {
          status: 'attention',
          lastError: message.slice(0, 1_000),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      ),
    ]);
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
): Promise<{ received: number; processed: number }> => {
  const connection = await loadConnectionDocument(tenantId);
  if (!connection || connection.status === 'disabled') {
    throw new Error('A integração 99Food não está configurada.');
  }
  const client = new OpenDeliveryClient(connectionRuntime(connection));
  const events = await client.pollEvents();
  const acknowledged: OpenDeliveryEvent[] = [];

  for (const event of events) {
    await processNinetyNineFoodEvent(connection, event);
    acknowledged.push(event);
  }
  await client.acknowledgeEvents(acknowledged);
  await adminDb.doc(connectionPath(tenantId)).set(
    {
      lastPollAt: FieldValue.serverTimestamp(),
      lastError: '',
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  return { received: events.length, processed: acknowledged.length };
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
    } catch (error) {
      failures += 1;
      await document.ref.set(
        {
          status: 'attention',
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
          updatedAt: FieldValue.serverTimestamp(),
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
  const snapshot = await adminDb.doc(legacyOrderPath(tenantId, orderId)).get();
  const data = snapshot.data();
  if (!data) throw new Error('Pedido 99Food não encontrado no Kyrub.');
  const integration = data.integration as Record<string, unknown> | undefined;
  const action = buildOpenDeliveryAction(externalOrderId, nextStatus, {
    displayId: clean(integration?.displayId) || externalOrderId,
    createdAt: clean(data.createdAt) || new Date().toISOString(),
    reason,
  });
  const client = new OpenDeliveryClient(connectionRuntime(connection));
  await client.sendAction(action);
  await updatePersistedOrderStatus(
    tenantId,
    externalOrderId,
    nextStatus,
    `KYRUB_${nextStatus.toLocaleUpperCase('en-US')}`
  );
};
