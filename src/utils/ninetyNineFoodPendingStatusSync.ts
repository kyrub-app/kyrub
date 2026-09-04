import type { User } from 'firebase/auth';
import type { CustomerOrderStatus } from './customerOrders';
import { notifyNinetyNineFoodStatusSyncReconciliationChanged } from './ninetyNineFoodStatusSyncReconciliation';

export type NinetyNineFoodPendingStatusSyncState =
  | 'authorization_required'
  | 'attention';

export interface NinetyNineFoodPendingStatusSyncItem {
  orderId: string;
  orderRevision: string;
  externalOrderId: string;
  displayId: string;
  customerName: string;
  status: CustomerOrderStatus;
  outboundStatus: NinetyNineFoodPendingStatusSyncState;
  outboundError: string;
  outboundUpdatedAt: string;
}

export interface NinetyNineFoodPendingStatusSyncResult {
  orderId: string;
  orderRevision: string;
  executionId: string;
  externalOrderId: string;
  status: CustomerOrderStatus;
  partnerSync: 'sent' | 'attention' | 'reconciliation_required';
  partnerWarning: string;
  localTransitionApplied: false;
}

const ORDER_STATUSES = new Set<CustomerOrderStatus>([
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
  'completed',
  'rejected',
  'cancelled',
]);

const request = async <T>(
  user: User,
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const token = await user.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(path, {
    ...init,
    headers,
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload.error === 'string' && payload.error.trim()
        ? payload.error.trim()
        : `A sincronização 99Food não pôde ser concluída (${response.status}).`
    );
  }
  return payload as T;
};

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseItem = (value: unknown): NinetyNineFoodPendingStatusSyncItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const orderId = clean(candidate.orderId);
  const orderRevision = clean(candidate.orderRevision);
  const externalOrderId = clean(candidate.externalOrderId);
  const status = clean(candidate.status) as CustomerOrderStatus;
  const outboundStatus = clean(candidate.outboundStatus);
  if (
    !orderId ||
    !orderRevision ||
    !externalOrderId ||
    !ORDER_STATUSES.has(status) ||
    (outboundStatus !== 'authorization_required' && outboundStatus !== 'attention')
  ) {
    return null;
  }
  return {
    orderId,
    orderRevision,
    externalOrderId,
    displayId: clean(candidate.displayId) || externalOrderId,
    customerName: clean(candidate.customerName),
    status,
    outboundStatus,
    outboundError: clean(candidate.outboundError),
    outboundUpdatedAt: clean(candidate.outboundUpdatedAt),
  };
};

export const loadNinetyNineFoodPendingStatusSyncs = async (
  user: User
): Promise<NinetyNineFoodPendingStatusSyncItem[]> => {
  const payload = await request<{ items?: unknown }>(
    user,
    '/api/orders/provider-sync/99food/pending'
  );
  return (Array.isArray(payload.items) ? payload.items : [])
    .map(parseItem)
    .filter((item): item is NinetyNineFoodPendingStatusSyncItem => Boolean(item));
};

export const sendNinetyNineFoodPendingStatusSync = async (
  user: User,
  item: NinetyNineFoodPendingStatusSyncItem
): Promise<NinetyNineFoodPendingStatusSyncResult> => {
  const orderId = item.orderId.trim();
  const orderRevision = item.orderRevision.trim();
  if (!orderId || !orderRevision || !ORDER_STATUSES.has(item.status)) {
    throw new Error('Pendência 99Food inválida para envio manual.');
  }
  const payload = await request<Record<string, unknown>>(
    user,
    `/api/orders/${encodeURIComponent(orderId)}/provider-sync/99food`,
    {
      method: 'POST',
      body: JSON.stringify({
        providerWriteAuthorization: {
          provider: '99food',
          status: item.status,
          orderRevision,
          confirmed: true,
        },
      }),
    }
  );
  const partnerSync =
    payload.partnerSync === 'sent' ||
    payload.partnerSync === 'attention' ||
    payload.partnerSync === 'reconciliation_required'
      ? payload.partnerSync
      : null;
  const resultOrderId = clean(payload.orderId);
  const resultOrderRevision = clean(payload.orderRevision);
  const executionId = clean(payload.executionId);
  const externalOrderId = clean(payload.externalOrderId);
  const status = clean(payload.status) as CustomerOrderStatus;
  if (
    !partnerSync ||
    !resultOrderId ||
    !resultOrderRevision ||
    !executionId ||
    !externalOrderId ||
    !ORDER_STATUSES.has(status) ||
    payload.localTransitionApplied !== false
  ) {
    throw new Error('A resposta autoritativa da sincronização 99Food está incompleta.');
  }
  if (partnerSync === 'reconciliation_required') {
    notifyNinetyNineFoodStatusSyncReconciliationChanged();
  }
  return {
    orderId: resultOrderId,
    orderRevision: resultOrderRevision,
    executionId,
    externalOrderId,
    status,
    partnerSync,
    partnerWarning: clean(payload.partnerWarning),
    localTransitionApplied: false,
  };
};
