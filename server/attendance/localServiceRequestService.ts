import type { DocumentData } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import {
  buildLocalServiceRequest,
  localServiceRequestId,
  parseLocalServiceRequestCreateInput,
  type LocalServiceRequest,
  type LocalServiceRequestStatus,
} from '../../shared/localServiceRequest.js';
import { resolveOrderServiceLocation } from '../../shared/serviceLocation.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';

const clean = (value: unknown, max = 220): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const legacyOrderPath = (storeId: string, orderId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders/${orderId}`;
const requestPath = (storeId: string, requestId: string): string =>
  `stores/${storeId}/localServiceRequests/${requestId}`;
const requestCollectionPath = (storeId: string): string =>
  `stores/${storeId}/localServiceRequests`;

const activeStatus = (value: unknown): value is 'open' | 'acknowledged' =>
  value === 'open' || value === 'acknowledged';

const readRequest = (
  data: DocumentData,
  storeId: string,
  requestId: string
): LocalServiceRequest => {
  if (
    data.schemaVersion !== 1 ||
    clean(data.id) !== requestId ||
    clean(data.storeId) !== storeId ||
    !clean(data.legacyStoreId) ||
    !clean(data.orderId) ||
    !clean(data.customerId) ||
    (data.kind !== 'assistance' && data.kind !== 'payment_terminal') ||
    (data.status !== 'open' && data.status !== 'acknowledged' &&
      data.status !== 'resolved' && data.status !== 'cancelled') ||
    !Number.isSafeInteger(data.occurrence) || Number(data.occurrence) <= 0 ||
    !resolveOrderServiceLocation({ serviceLocation: data.serviceLocation }) ||
    !clean(data.requestedAt) || !clean(data.updatedAt)
  ) {
    throw new Error('LOCAL_SERVICE_REQUEST_RECORD_INVALID');
  }
  return data as LocalServiceRequest;
};

const loadCustomerOrder = async (legacyStoreId: string, orderId: string) => {
  const snapshot = await adminDb.doc(legacyOrderPath(legacyStoreId, orderId)).get();
  if (!snapshot.exists) throw new Error('LOCAL_SERVICE_REQUEST_ORDER_NOT_FOUND');
  return snapshot.data() as DocumentData;
};

const assertCustomerCanRequest = (
  order: DocumentData,
  orderId: string,
  customerId: string
): void => {
  if (
    clean(order.id) !== orderId ||
    clean(order.buyerId) !== customerId ||
    order.fulfillmentType !== 'dine_in'
  ) {
    throw new Error('LOCAL_SERVICE_REQUEST_ORDER_FORBIDDEN');
  }
  if (order.status === 'completed' || order.status === 'rejected' || order.status === 'cancelled') {
    throw new Error('LOCAL_SERVICE_REQUEST_ORDER_CLOSED');
  }
  if (!resolveOrderServiceLocation({
    serviceLocation: order.serviceLocation,
    tableCode: order.tableCode,
  })) {
    throw new Error('LOCAL_SERVICE_REQUEST_LOCATION_REQUIRED');
  }
};

export const createLocalServiceRequest = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<LocalServiceRequest> => {
  const request = parseLocalServiceRequestCreateInput(input.value);
  const customerId = clean(input.authenticatedUserId, 180);
  if (!customerId) throw new Error('LOCAL_SERVICE_REQUEST_AUTH_REQUIRED');
  const context = await resolveInPersonOrderStoreContext(request.storeId);
  const order = await loadCustomerOrder(context.legacyStoreId, request.orderId);
  assertCustomerCanRequest(order, request.orderId, customerId);
  const serviceLocation = resolveOrderServiceLocation({
    serviceLocation: order.serviceLocation,
    tableCode: order.tableCode,
  });
  if (!serviceLocation) throw new Error('LOCAL_SERVICE_REQUEST_LOCATION_REQUIRED');

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('LOCAL_SERVICE_REQUEST_TIME_INVALID');
  const timestamp = now.toISOString();
  const id = localServiceRequestId(request.orderId, request.kind);
  const reference = adminDb.doc(requestPath(context.canonicalStoreId, id));

  return adminDb.runTransaction(async transaction => {
    const currentSnapshot = await transaction.get(reference);
    if (currentSnapshot.exists) {
      const current = readRequest(currentSnapshot.data()!, context.canonicalStoreId, id);
      if (current.customerId !== customerId || current.orderId !== request.orderId) {
        throw new Error('LOCAL_SERVICE_REQUEST_SCOPE_CONFLICT');
      }
      if (activeStatus(current.status)) return current;
      const reopened = buildLocalServiceRequest({
        id,
        storeId: context.canonicalStoreId,
        legacyStoreId: context.legacyStoreId,
        orderId: request.orderId,
        customerId,
        kind: request.kind,
        serviceLocation,
        occurrence: current.occurrence + 1,
        requestedAt: timestamp,
      });
      transaction.set(reference, reopened);
      return reopened;
    }

    const created = buildLocalServiceRequest({
      id,
      storeId: context.canonicalStoreId,
      legacyStoreId: context.legacyStoreId,
      orderId: request.orderId,
      customerId,
      kind: request.kind,
      serviceLocation,
      requestedAt: timestamp,
    });
    transaction.create(reference, created);
    return created;
  });
};

export const listActiveLocalServiceRequests = async (input: {
  legacyStoreId: string;
}): Promise<LocalServiceRequest[]> => {
  const context = await resolveInPersonOrderStoreContext(input.legacyStoreId);
  const snapshot = await adminDb
    .collection(requestCollectionPath(context.canonicalStoreId))
    .where('status', 'in', ['open', 'acknowledged'])
    .limit(100)
    .get();
  return snapshot.docs
    .map(document => readRequest(document.data(), context.canonicalStoreId, document.id))
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt));
};

const transitionRequest = async (input: {
  legacyStoreId: string;
  requestId: string;
  actorUserId: string;
  target: 'acknowledged' | 'resolved';
  now?: Date;
}): Promise<LocalServiceRequest> => {
  const context = await resolveInPersonOrderStoreContext(input.legacyStoreId);
  const requestId = clean(input.requestId);
  const actorUserId = clean(input.actorUserId, 180);
  if (!requestId || !actorUserId) throw new Error('LOCAL_SERVICE_REQUEST_TRANSITION_INVALID');
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('LOCAL_SERVICE_REQUEST_TIME_INVALID');
  const timestamp = now.toISOString();
  const reference = adminDb.doc(requestPath(context.canonicalStoreId, requestId));

  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('LOCAL_SERVICE_REQUEST_NOT_FOUND');
    const current = readRequest(snapshot.data()!, context.canonicalStoreId, requestId);
    if (input.target === 'acknowledged') {
      if (current.status === 'acknowledged') return current;
      if (current.status !== 'open') throw new Error('LOCAL_SERVICE_REQUEST_NOT_ACTIVE');
      const next: LocalServiceRequest = {
        ...current,
        status: 'acknowledged',
        acknowledgedAt: timestamp,
        acknowledgedByUserId: actorUserId,
        updatedAt: timestamp,
      };
      transaction.set(reference, next);
      return next;
    }
    if (current.status === 'resolved') return current;
    if (!activeStatus(current.status)) throw new Error('LOCAL_SERVICE_REQUEST_NOT_ACTIVE');
    const next: LocalServiceRequest = {
      ...current,
      status: 'resolved',
      resolvedAt: timestamp,
      resolvedByUserId: actorUserId,
      updatedAt: timestamp,
    };
    transaction.set(reference, next);
    return next;
  });
};

export const acknowledgeLocalServiceRequest = (input: {
  legacyStoreId: string;
  requestId: string;
  actorUserId: string;
  now?: Date;
}) => transitionRequest({ ...input, target: 'acknowledged' });

export const resolveLocalServiceRequest = (input: {
  legacyStoreId: string;
  requestId: string;
  actorUserId: string;
  now?: Date;
}) => transitionRequest({ ...input, target: 'resolved' });

export const cancelOwnLocalServiceRequest = async (input: {
  authenticatedUserId: string;
  legacyStoreId: string;
  requestId: string;
  now?: Date;
}): Promise<LocalServiceRequest> => {
  const context = await resolveInPersonOrderStoreContext(input.legacyStoreId);
  const customerId = clean(input.authenticatedUserId, 180);
  const requestId = clean(input.requestId);
  if (!customerId || !requestId) throw new Error('LOCAL_SERVICE_REQUEST_CANCEL_INVALID');
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const reference = adminDb.doc(requestPath(context.canonicalStoreId, requestId));
  return adminDb.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new Error('LOCAL_SERVICE_REQUEST_NOT_FOUND');
    const current = readRequest(snapshot.data()!, context.canonicalStoreId, requestId);
    if (current.customerId !== customerId) throw new Error('LOCAL_SERVICE_REQUEST_FORBIDDEN');
    if (current.status === 'cancelled') return current;
    if (!activeStatus(current.status)) throw new Error('LOCAL_SERVICE_REQUEST_NOT_ACTIVE');
    const next: LocalServiceRequest = {
      ...current,
      status: 'cancelled',
      cancelledAt: timestamp,
      updatedAt: timestamp,
    };
    transaction.set(reference, next);
    return next;
  });
};
