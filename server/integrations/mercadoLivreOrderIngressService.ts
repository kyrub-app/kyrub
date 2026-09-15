import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  isMercadoLivreCommerciallyConfirmed,
  isMercadoLivreFinalCancellation,
  mercadoLivreOrderIdFromResource,
  normalizeMercadoLivrePaidOrderForKds,
  parseMercadoLivreOrderSnapshot,
  type MercadoLivreResolvedOrderItemBinding,
} from '../../shared/mercadoLivreOrderIngress.js';
import { mercadoLivreGetJson } from './mercadoLivreOauthService.js';
import { getStoreConnectionRegistryRecord } from './storeConnectionRegistry.js';

interface MercadoLivreOrderInboxRecord {
  provider: 'mercado_livre';
  notificationId: string;
  topic: 'orders_v2';
  resource: string;
  externalAccountId: string;
  storeId: string;
  connectionId: string;
  disposition: 'pending_fetch';
  processingStatus: 'pending' | 'processed' | 'failed';
  authority: 'provider_notification_trigger';
}

export interface MercadoLivreOrderIngressResult {
  alreadyProcessed: boolean;
  externalOrderId?: string;
  orderId?: string;
  outcome?:
    | 'created'
    | 'updated'
    | 'awaiting_commercial_confirmation'
    | 'cancelled_before_ingress'
    | 'cancelled_pending_order'
    | 'provider_cancellation_review_required'
    | 'blocked_product_binding';
  missingExternalItemIds?: string[];
}

const clean = (value: unknown, maximum = 2_000): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const legacyOrderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

const canonicalStoreIdForTenant = async (tenantId: string): Promise<string> => {
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  return clean(tenant.data()?.canonicalStoreId, 160);
};

const assertOrderInbox = (value: unknown): MercadoLivreOrderInboxRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MERCADO_LIVRE_ORDER_INBOX_INVALID');
  }
  const record = value as Partial<MercadoLivreOrderInboxRecord>;
  if (
    record.provider !== 'mercado_livre' ||
    record.topic !== 'orders_v2' ||
    record.disposition !== 'pending_fetch' ||
    record.authority !== 'provider_notification_trigger' ||
    !clean(record.notificationId, 200) ||
    !clean(record.resource, 500) ||
    !clean(record.storeId, 160) ||
    !clean(record.connectionId, 200) ||
    !clean(record.externalAccountId, 100)
  ) throw new Error('MERCADO_LIVRE_ORDER_INBOX_INVALID');
  if (
    record.processingStatus !== 'pending' &&
    record.processingStatus !== 'processed' &&
    record.processingStatus !== 'failed'
  ) throw new Error('MERCADO_LIVRE_ORDER_INBOX_INVALID');
  return record as MercadoLivreOrderInboxRecord;
};

const bindingIdFor = (storeId: string, connectionId: string, externalItemId: string): string => {
  const identity = createHash('sha256')
    .update([storeId, 'mercado_livre', connectionId, externalItemId].join(':'))
    .digest('hex');
  return `mlbind_${identity.slice(0, 32)}`;
};

const resolveOrderBindings = async (input: {
  storeId: string;
  connectionId: string;
  externalItemIds: string[];
  tenantCanonicalStoreId: string;
}): Promise<{
  bindings: MercadoLivreResolvedOrderItemBinding[];
  missingExternalItemIds: string[];
  canonicalStoreId: string;
}> => {
  const externalItemIds = [...new Set(input.externalItemIds.map(id => id.trim()).filter(Boolean))];
  const documents = await Promise.all(externalItemIds.map(async externalItemId => {
    const bindingId = bindingIdFor(input.storeId, input.connectionId, externalItemId);
    const snapshot = await adminDb.doc(
      `stores/${input.storeId}/externalCatalogBindings/${bindingId}`
    ).get();
    return { externalItemId, snapshot };
  }));

  const bindings: MercadoLivreResolvedOrderItemBinding[] = [];
  const missingExternalItemIds: string[] = [];
  const canonicalStoreIds = new Set<string>();

  for (const { externalItemId, snapshot } of documents) {
    const value = snapshot.data() as Record<string, unknown> | undefined;
    const canonicalProductId = clean(value?.canonicalProductId, 160);
    const canonicalStoreId = clean(value?.canonicalStoreId, 160);
    if (
      !snapshot.exists ||
      value?.provider !== 'mercado_livre' ||
      clean(value?.storeId, 160) !== input.storeId ||
      clean(value?.connectionId, 200) !== input.connectionId ||
      clean(value?.externalItemId, 160) !== externalItemId ||
      value?.status !== 'active' ||
      !canonicalProductId ||
      !canonicalStoreId
    ) {
      missingExternalItemIds.push(externalItemId);
      continue;
    }
    if (input.tenantCanonicalStoreId && canonicalStoreId !== input.tenantCanonicalStoreId) {
      missingExternalItemIds.push(externalItemId);
      continue;
    }
    canonicalStoreIds.add(canonicalStoreId);
    bindings.push({ externalItemId, canonicalProductId, canonicalStoreId });
  }

  const resolvedCanonicalStoreId = input.tenantCanonicalStoreId || [...canonicalStoreIds][0] || '';
  if (canonicalStoreIds.size > 1) {
    return {
      bindings: [],
      missingExternalItemIds: externalItemIds,
      canonicalStoreId: '',
    };
  }
  return { bindings, missingExternalItemIds, canonicalStoreId: resolvedCanonicalStoreId };
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const currentOrderStatus = (value: unknown): string => clean(asRecord(value).status, 80);

const canonicalOrder = (
  order: Record<string, unknown>,
  canonicalStoreId: string,
  tenantId: string
): Record<string, unknown> => ({
  ...order,
  storeId: canonicalStoreId,
  legacyStoreId: tenantId,
  migratedFromPath: legacyOrderPath(tenantId, clean(order.id, 180)),
  createdByUserId: 'integration:mercado_livre',
  createdByRole: 'integration',
  migration: {
    mode: 'integration',
    provider: 'mercado_livre',
    source: 'orders_v2',
  },
});

const legacyOrderFromCanonical = (
  order: Record<string, unknown>,
  tenantId: string
): Record<string, unknown> => ({
  ...order,
  storeId: tenantId,
});

const integrationState = (input: {
  externalOrderId: string;
  providerStatus: string;
  inbox: MercadoLivreOrderInboxRecord;
  fetchedAt: string;
}): Record<string, unknown> => ({
  ...asRecord(asRecord(input).integration),
  provider: 'mercado_livre',
  externalOrderId: input.externalOrderId,
  providerStatus: input.providerStatus,
  authority: 'provider_api_refetch',
  routingTarget: 'KDS',
  connectionId: input.inbox.connectionId,
  externalAccountId: input.inbox.externalAccountId,
  lastNotificationId: input.inbox.notificationId,
  lastNotificationTopic: input.inbox.topic,
  lastProviderFetchAt: input.fetchedAt,
});

const mergeProviderState = (input: {
  order: Record<string, unknown>;
  externalOrderId: string;
  providerStatus: string;
  inbox: MercadoLivreOrderInboxRecord;
  fetchedAt: string;
  status?: string;
}): Record<string, unknown> => ({
  ...input.order,
  ...(input.status ? { status: input.status } : {}),
  integration: {
    ...asRecord(input.order.integration),
    ...integrationState(input),
  },
  updatedAt: input.fetchedAt,
});

export const processMercadoLivreOrderNotificationInboxItem = async (input: {
  inboxId: string;
  expectedStoreId?: string;
}): Promise<MercadoLivreOrderIngressResult> => {
  const inboxId = input.inboxId.trim();
  if (!/^mercado_livre__[a-f0-9]{64}$/.test(inboxId)) {
    throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_ID_INVALID');
  }
  const inboxRef = adminDb.doc(`integrationWebhookInbox/${inboxId}`);
  const inboxDocument = await inboxRef.get();
  if (!inboxDocument.exists) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
  const inbox = assertOrderInbox(inboxDocument.data());
  const expectedStoreId = input.expectedStoreId?.trim() ?? '';
  if (expectedStoreId && expectedStoreId !== inbox.storeId) throw new Error('STORE_CONNECTION_FORBIDDEN');
  if (inbox.processingStatus === 'processed') return { alreadyProcessed: true };
  if (inbox.processingStatus !== 'pending') throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_PENDING');

  const connection = await getStoreConnectionRegistryRecord({
    storeId: inbox.storeId,
    connectionId: inbox.connectionId,
  });
  if (
    !connection ||
    connection.provider !== 'mercado_livre' ||
    connection.status !== 'connected' ||
    connection.externalAccountId !== inbox.externalAccountId
  ) throw new Error('MERCADO_LIVRE_CONNECTION_INVALID');

  const externalOrderId = mercadoLivreOrderIdFromResource(inbox.resource);
  const fetched = await mercadoLivreGetJson<unknown>(
    inbox.storeId,
    `/orders/${encodeURIComponent(externalOrderId)}`
  );
  const fetchedAt = new Date().toISOString();
  const snapshot = parseMercadoLivreOrderSnapshot(fetched, externalOrderId, fetchedAt);
  if (snapshot.sellerId && snapshot.sellerId !== inbox.externalAccountId) {
    throw new Error('MERCADO_LIVRE_ORDER_SELLER_MISMATCH');
  }

  const orderId = `mercado-livre-order-${externalOrderId}`;
  const tenantCanonicalStoreId = await canonicalStoreIdForTenant(inbox.storeId);
  const legacyRef = adminDb.doc(legacyOrderPath(inbox.storeId, orderId));
  const canonicalRef = tenantCanonicalStoreId
    ? adminDb.doc(`stores/${tenantCanonicalStoreId}/orders/${orderId}`)
    : null;
  const [legacyOrderDocument, canonicalOrderDocument] = await Promise.all([
    legacyRef.get(),
    canonicalRef ? canonicalRef.get() : Promise.resolve(null),
  ]);
  const existingOrderData = canonicalOrderDocument?.exists
    ? canonicalOrderDocument.data()
    : legacyOrderDocument.exists
      ? legacyOrderDocument.data()
      : undefined;
  const existingStatus = currentOrderStatus(existingOrderData);

  if (!existingStatus && !isMercadoLivreCommerciallyConfirmed(snapshot)) {
    const outcome = isMercadoLivreFinalCancellation(snapshot)
      ? 'cancelled_before_ingress'
      : 'awaiting_commercial_confirmation';
    await adminDb.runTransaction(async transaction => {
      const currentInboxDocument = await transaction.get(inboxRef);
      if (!currentInboxDocument.exists) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
      const currentInbox = assertOrderInbox(currentInboxDocument.data());
      if (currentInbox.processingStatus === 'processed') return;
      if (currentInbox.processingStatus !== 'pending') {
        throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_PENDING');
      }
      transaction.update(inboxRef, {
        processingStatus: 'processed',
        processedAt: FieldValue.serverTimestamp(),
        processingAuthority: 'provider_api_refetch',
        processingOutcome: outcome,
        externalOrderId,
        providerOrderStatus: snapshot.providerStatus,
      });
    });
    return { alreadyProcessed: false, externalOrderId, orderId, outcome };
  }

  if (existingStatus) {
    let outcome: MercadoLivreOrderIngressResult['outcome'] = 'updated';
    let processedByOtherWorker = false;
    await adminDb.runTransaction(async transaction => {
      const currentInboxDocument = await transaction.get(inboxRef);
      if (!currentInboxDocument.exists) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
      const currentInbox = assertOrderInbox(currentInboxDocument.data());
      if (currentInbox.processingStatus === 'processed') {
        processedByOtherWorker = true;
        return;
      }
      if (currentInbox.processingStatus !== 'pending') {
        throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_PENDING');
      }

      const currentLegacy = await transaction.get(legacyRef);
      const currentCanonical = canonicalRef ? await transaction.get(canonicalRef) : null;
      const currentCanonicalData = currentCanonical?.exists ? asRecord(currentCanonical.data()) : {};
      const currentLegacyData = currentLegacy.exists ? asRecord(currentLegacy.data()) : {};
      const authoritativeOrder = currentCanonical?.exists ? currentCanonicalData : currentLegacyData;
      const authoritativeStatus = currentOrderStatus(authoritativeOrder);
      if (!authoritativeStatus) throw new Error('MERCADO_LIVRE_ORDER_EXISTING_STATE_INVALID');

      let nextStatus = authoritativeStatus;
      if (isMercadoLivreFinalCancellation(snapshot) && authoritativeStatus === 'pending') {
        outcome = 'cancelled_pending_order';
        nextStatus = 'cancelled';
      } else if (
        isMercadoLivreFinalCancellation(snapshot) &&
        authoritativeStatus !== 'cancelled' &&
        authoritativeStatus !== 'rejected'
      ) {
        outcome = 'provider_cancellation_review_required';
        const divergenceRef = adminDb.doc(
          `stores/${inbox.storeId}/omnichannelDivergences/mercado_livre_order_${externalOrderId}`
        );
        transaction.set(divergenceRef, {
          provider: 'mercado_livre',
          storeId: inbox.storeId,
          orderId,
          externalOrderId,
          kind: 'provider_cancellation_after_kyrub_progress',
          providerStatus: snapshot.providerStatus,
          kyrubStatus: authoritativeStatus,
          authority: 'manual_resolution_required',
          detectedAt: fetchedAt,
          serverDetectedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }

      const merge = (order: Record<string, unknown>) => mergeProviderState({
        order,
        externalOrderId,
        providerStatus: snapshot.providerStatus,
        inbox,
        fetchedAt,
        status: nextStatus,
      });
      const mergedAuthoritativeOrder = merge(authoritativeOrder);

      if (currentLegacy.exists) {
        transaction.set(legacyRef, merge(currentLegacyData));
      } else {
        transaction.set(legacyRef, legacyOrderFromCanonical(mergedAuthoritativeOrder, inbox.storeId));
      }

      if (canonicalRef) {
        if (currentCanonical?.exists) {
          transaction.set(canonicalRef, merge(currentCanonicalData));
        } else {
          transaction.set(
            canonicalRef,
            canonicalOrder(mergedAuthoritativeOrder, tenantCanonicalStoreId, inbox.storeId)
          );
        }
      }

      transaction.update(inboxRef, {
        processingStatus: 'processed',
        processedAt: FieldValue.serverTimestamp(),
        processingAuthority: 'provider_api_refetch',
        processingOutcome: outcome,
        externalOrderId,
        providerOrderStatus: snapshot.providerStatus,
        orderId,
      });
    });

    if (processedByOtherWorker) return { alreadyProcessed: true, externalOrderId, orderId };
    return { alreadyProcessed: false, externalOrderId, orderId, outcome };
  }

  const bindingResolution = await resolveOrderBindings({
    storeId: inbox.storeId,
    connectionId: inbox.connectionId,
    externalItemIds: snapshot.lines.map(line => line.externalItemId),
    tenantCanonicalStoreId,
  });
  if (
    bindingResolution.missingExternalItemIds.length ||
    !bindingResolution.canonicalStoreId
  ) {
    const missingExternalItemIds = bindingResolution.missingExternalItemIds.length
      ? bindingResolution.missingExternalItemIds
      : snapshot.lines.map(line => line.externalItemId);
    const blockRef = adminDb.doc(
      `stores/${inbox.storeId}/mercadoLivreOrderIngressBlocks/${orderId}`
    );
    let processedByOtherWorker = false;
    await adminDb.runTransaction(async transaction => {
      const currentInboxDocument = await transaction.get(inboxRef);
      if (!currentInboxDocument.exists) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
      const currentInbox = assertOrderInbox(currentInboxDocument.data());
      if (currentInbox.processingStatus === 'processed') {
        processedByOtherWorker = true;
        return;
      }
      if (currentInbox.processingStatus !== 'pending') {
        throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_PENDING');
      }
      transaction.set(blockRef, {
        provider: 'mercado_livre',
        storeId: inbox.storeId,
        connectionId: inbox.connectionId,
        externalOrderId,
        orderId,
        providerOrderStatus: snapshot.providerStatus,
        missingExternalItemIds,
        status: 'product_binding_required',
        authority: 'manual_resolution_required',
        sourceNotificationId: inbox.notificationId,
        detectedAt: fetchedAt,
        serverDetectedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      transaction.update(inboxRef, {
        processingStatus: 'processed',
        processedAt: FieldValue.serverTimestamp(),
        processingAuthority: 'provider_api_refetch',
        processingOutcome: 'blocked_product_binding',
        externalOrderId,
        providerOrderStatus: snapshot.providerStatus,
        orderId,
      });
    });
    if (processedByOtherWorker) return { alreadyProcessed: true, externalOrderId, orderId };
    return {
      alreadyProcessed: false,
      externalOrderId,
      orderId,
      outcome: 'blocked_product_binding',
      missingExternalItemIds,
    };
  }

  const order = normalizeMercadoLivrePaidOrderForKds({
    snapshot,
    tenantId: inbox.storeId,
    canonicalStoreId: bindingResolution.canonicalStoreId,
    bindings: bindingResolution.bindings,
  });
  const fullIntegrationState = {
    ...order.integration,
    connectionId: inbox.connectionId,
    externalAccountId: inbox.externalAccountId,
    lastNotificationId: inbox.notificationId,
    lastNotificationTopic: inbox.topic,
    lastProviderFetchAt: fetchedAt,
  };
  const legacyOrder = { ...order, integration: fullIntegrationState } as Record<string, unknown>;
  const canonicalOrderRef = adminDb.doc(
    `stores/${bindingResolution.canonicalStoreId}/orders/${order.id}`
  );
  let created = false;
  let processedByOtherWorker = false;

  await adminDb.runTransaction(async transaction => {
    const currentInboxDocument = await transaction.get(inboxRef);
    if (!currentInboxDocument.exists) throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_FOUND');
    const currentInbox = assertOrderInbox(currentInboxDocument.data());
    if (currentInbox.processingStatus === 'processed') {
      processedByOtherWorker = true;
      return;
    }
    if (currentInbox.processingStatus !== 'pending') {
      throw new Error('MERCADO_LIVRE_NOTIFICATION_INBOX_NOT_PENDING');
    }

    const currentLegacy = await transaction.get(legacyRef);
    const currentCanonical = await transaction.get(canonicalOrderRef);
    if (!currentLegacy.exists && !currentCanonical.exists) {
      created = true;
      transaction.set(legacyRef, legacyOrder);
      transaction.set(
        canonicalOrderRef,
        canonicalOrder(legacyOrder, bindingResolution.canonicalStoreId, inbox.storeId)
      );
    } else {
      const authoritativeOrder = currentCanonical.exists
        ? asRecord(currentCanonical.data())
        : asRecord(currentLegacy.data());
      const mergedOrder = mergeProviderState({
        order: authoritativeOrder,
        externalOrderId,
        providerStatus: snapshot.providerStatus,
        inbox,
        fetchedAt,
      });
      transaction.set(
        legacyRef,
        currentLegacy.exists
          ? mergeProviderState({
              order: asRecord(currentLegacy.data()),
              externalOrderId,
              providerStatus: snapshot.providerStatus,
              inbox,
              fetchedAt,
            })
          : legacyOrderFromCanonical(mergedOrder, inbox.storeId)
      );
      transaction.set(
        canonicalOrderRef,
        currentCanonical.exists
          ? mergeProviderState({
              order: asRecord(currentCanonical.data()),
              externalOrderId,
              providerStatus: snapshot.providerStatus,
              inbox,
              fetchedAt,
            })
          : canonicalOrder(mergedOrder, bindingResolution.canonicalStoreId, inbox.storeId)
      );
    }

    transaction.update(inboxRef, {
      processingStatus: 'processed',
      processedAt: FieldValue.serverTimestamp(),
      processingAuthority: 'provider_api_refetch',
      processingOutcome: created ? 'created' : 'updated',
      externalOrderId,
      providerOrderStatus: snapshot.providerStatus,
      orderId,
      canonicalStoreId: bindingResolution.canonicalStoreId,
    });
  });

  if (processedByOtherWorker) return { alreadyProcessed: true, externalOrderId, orderId };
  return {
    alreadyProcessed: false,
    externalOrderId,
    orderId,
    outcome: created ? 'created' : 'updated',
  };
};
