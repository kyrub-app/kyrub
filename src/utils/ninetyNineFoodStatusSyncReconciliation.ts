import type { User } from 'firebase/auth';
import type { CustomerOrderStatus } from './customerOrders';

export const KYRUB_99FOOD_STATUS_SYNC_RECONCILIATION_CHANGED_EVENT =
  'kyrub:99food-status-sync-reconciliation-changed';

export type NinetyNineFoodStatusSyncReconciliationPhase =
  | 'claimed'
  | 'provider_write_started'
  | 'provider_write_outcome_unknown'
  | 'reconciliation_uncertain'
  | 'reconciliation_checking';

export interface NinetyNineFoodStatusSyncReconciliationItem {
  executionId: string;
  orderId: string;
  externalOrderId: string;
  displayId: string;
  customerName: string;
  targetStatus: CustomerOrderStatus;
  executionStatus: NinetyNineFoodStatusSyncReconciliationPhase;
  outboundStatus: 'executing' | 'reconciliation_required';
  warning: string;
  claimedAt: string;
  providerWriteStartedAt: string;
  ageMs: number;
}

export type NinetyNineFoodStatusSyncReconciliationOutcome =
  | 'confirmed'
  | 'not_observed'
  | 'conflict'
  | 'uncertain';

export interface NinetyNineFoodStatusSyncReconciliationResult {
  executionId: string;
  orderId: string;
  externalOrderId: string;
  targetStatus: CustomerOrderStatus;
  reconciliation: NinetyNineFoodStatusSyncReconciliationOutcome;
  providerLastEvent: string;
  providerStatus: string;
  warning: string;
  orderMarkerFinalized: boolean;
  localStatusChanged: boolean;
  providerWriteAttempted: false;
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

const EXECUTION_PHASES = new Set<NinetyNineFoodStatusSyncReconciliationPhase>([
  'claimed',
  'provider_write_started',
  'provider_write_outcome_unknown',
  'reconciliation_uncertain',
  'reconciliation_checking',
]);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

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
  if (!response.ok && response.status !== 202) {
    throw new Error(
      clean(payload.error) ||
      `A reconciliação 99Food não pôde ser concluída (${response.status}).`
    );
  }
  return payload as T;
};

const parseItem = (value: unknown): NinetyNineFoodStatusSyncReconciliationItem | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const executionId = clean(candidate.executionId);
  const orderId = clean(candidate.orderId);
  const externalOrderId = clean(candidate.externalOrderId);
  const targetStatus = clean(candidate.targetStatus) as CustomerOrderStatus;
  const executionStatus = clean(candidate.executionStatus) as NinetyNineFoodStatusSyncReconciliationPhase;
  const outboundStatus = clean(candidate.outboundStatus);
  const ageMs = typeof candidate.ageMs === 'number' && Number.isFinite(candidate.ageMs)
    ? Math.max(0, candidate.ageMs)
    : 0;
  if (
    !executionId ||
    !orderId ||
    !externalOrderId ||
    !ORDER_STATUSES.has(targetStatus) ||
    !EXECUTION_PHASES.has(executionStatus) ||
    (outboundStatus !== 'executing' && outboundStatus !== 'reconciliation_required')
  ) {
    return null;
  }
  return {
    executionId,
    orderId,
    externalOrderId,
    displayId: clean(candidate.displayId) || externalOrderId,
    customerName: clean(candidate.customerName),
    targetStatus,
    executionStatus,
    outboundStatus,
    warning: clean(candidate.warning),
    claimedAt: clean(candidate.claimedAt),
    providerWriteStartedAt: clean(candidate.providerWriteStartedAt),
    ageMs,
  };
};

export const notifyNinetyNineFoodStatusSyncReconciliationChanged = (): void => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new Event(KYRUB_99FOOD_STATUS_SYNC_RECONCILIATION_CHANGED_EVENT)
  );
};

export const loadNinetyNineFoodStatusSyncReconciliationItems = async (
  user: User
): Promise<NinetyNineFoodStatusSyncReconciliationItem[]> => {
  const payload = await request<{ items?: unknown }>(
    user,
    '/api/orders/provider-sync/99food/reconciliation'
  );
  return (Array.isArray(payload.items) ? payload.items : [])
    .map(parseItem)
    .filter((item): item is NinetyNineFoodStatusSyncReconciliationItem => Boolean(item));
};

export const reconcileNinetyNineFoodStatusSyncExecution = async (
  user: User,
  item: NinetyNineFoodStatusSyncReconciliationItem
): Promise<NinetyNineFoodStatusSyncReconciliationResult> => {
  const payload = await request<Record<string, unknown>>(
    user,
    `/api/orders/${encodeURIComponent(item.orderId)}/provider-sync/99food/reconciliation/${encodeURIComponent(item.executionId)}`,
    { method: 'POST' }
  );
  const reconciliation = clean(payload.reconciliation) as NinetyNineFoodStatusSyncReconciliationOutcome;
  const targetStatus = clean(payload.targetStatus) as CustomerOrderStatus;
  if (
    !['confirmed', 'not_observed', 'conflict', 'uncertain'].includes(reconciliation) ||
    !ORDER_STATUSES.has(targetStatus) ||
    clean(payload.executionId) !== item.executionId ||
    clean(payload.orderId) !== item.orderId ||
    payload.providerWriteAttempted !== false ||
    payload.localTransitionApplied !== false
  ) {
    throw new Error('A resposta autoritativa da reconciliação 99Food está incompleta.');
  }
  const result: NinetyNineFoodStatusSyncReconciliationResult = {
    executionId: item.executionId,
    orderId: item.orderId,
    externalOrderId: clean(payload.externalOrderId),
    targetStatus,
    reconciliation,
    providerLastEvent: clean(payload.providerLastEvent),
    providerStatus: clean(payload.providerStatus),
    warning: clean(payload.warning),
    orderMarkerFinalized: payload.orderMarkerFinalized === true,
    localStatusChanged: payload.localStatusChanged === true,
    providerWriteAttempted: false,
    localTransitionApplied: false,
  };
  notifyNinetyNineFoodStatusSyncReconciliationChanged();
  return result;
};
