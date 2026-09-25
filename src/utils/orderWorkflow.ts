import type { User } from 'firebase/auth';
import { auth } from './firebase';
import type {
  CustomerOrder,
  CustomerOrderStatus,
} from './customerOrders';
import type { KyrubCommerceChannel } from '../../shared/storeConnections';
import {
  resolveOrderServiceLocation,
  serviceLocationIdentityKey,
  type ResolvedOrderServiceLocation,
} from '../../shared/serviceLocation';
import {
  publishNinetyNineFoodStatusWriteResult,
  requestNinetyNineFoodStatusWriteAuthority,
  type NinetyNineFoodStatusWriteResult,
} from './ninetyNineFoodStatusWriteAuthority';
import {
  loadNinetyNineFoodPendingStatusSyncs,
  sendNinetyNineFoodPendingStatusSync,
} from './ninetyNineFoodPendingStatusSync';
import { recordCurrentUserActivityEvent } from '../observability/kyrubActivityBrowser';

export type OrderDeliveryProvider = 'kyrub' | 'merchant';

export interface OrderDecision {
  reason?: string;
  alternative?: string;
  deliveryProvider?: OrderDeliveryProvider;
  handoffCode?: string;
}

export interface AttendanceReviewItem {
  lineId: string;
  quantity: number;
  note: string;
}

export interface AttendanceReviewInput {
  action: 'approve' | 'reject';
  items: AttendanceReviewItem[];
  customerNote: string;
  reason?: string;
  alternative?: string;
}

export interface OrderOriginOption {
  id: string;
  label: string;
  group: 'kyrub' | 'marketplace' | 'internal';
}

export interface OrderStatusUpdateResult {
  orderId: string;
  status: CustomerOrderStatus;
  provider: string;
  externalOrderId: string;
  partnerSync: NinetyNineFoodStatusWriteResult['partnerSync'];
  partnerWarning: string;
}

const attendanceLocationFor = (
  order: CustomerOrder
): ResolvedOrderServiceLocation | null =>
  resolveOrderServiceLocation({
    serviceLocation: order.serviceLocation,
    tableCode: order.tableCode,
  });

export const isNinetyNineFoodOrder = (order: CustomerOrder): boolean =>
  order.buyerId.toLocaleLowerCase('pt-BR').startsWith('99food:') ||
  order.operatorName.toLocaleLowerCase('pt-BR').includes('99food');

const isNinetyNineFoodOrderId = (orderId: string): boolean =>
  orderId.trim().toLocaleLowerCase('pt-BR').startsWith('99food-');

export const isPendingAttendanceApproval = (order: CustomerOrder): boolean =>
  order.source === 'customer' &&
  order.fulfillmentType === 'dine_in' &&
  Boolean(attendanceLocationFor(order)) &&
  order.status === 'pending' &&
  !order.operatorId.trim();

const isApprovalGatedKyrubMarketplaceOrder = (order: CustomerOrder): boolean =>
  order.source === 'customer' &&
  order.sourceChannel === 'kyrub' &&
  (order.fulfillmentType === 'delivery' || order.fulfillmentType === 'pickup') &&
  Boolean(order.buyerId.trim()) &&
  order.operatorId.trim() === order.buyerId.trim();

export const isOrderVisibleInKds = (order: CustomerOrder): boolean => {
  if (isPendingAttendanceApproval(order)) return false;
  if (order.source !== 'customer') return true;
  if (order.fulfillmentType === 'dine_in') return true;
  if (isNinetyNineFoodOrder(order)) return true;
  if (isApprovalGatedKyrubMarketplaceOrder(order)) return true;
  return order.paymentStatus === 'paid';
};

export const getPendingAttendanceOrdersForLocation = (
  orders: CustomerOrder[],
  location: ResolvedOrderServiceLocation
): CustomerOrder[] => {
  const expected = serviceLocationIdentityKey(location);
  return orders
    .filter(order => {
      if (!isPendingAttendanceApproval(order)) return false;
      const orderLocation = attendanceLocationFor(order);
      return Boolean(
        orderLocation && serviceLocationIdentityKey(orderLocation) === expected
      );
    })
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
};

export const getPendingAttendanceOrders = (
  orders: CustomerOrder[],
  tableCode: string
): CustomerOrder[] => {
  const normalizedTableCode = tableCode.trim();
  if (!normalizedTableCode) return [];
  return getPendingAttendanceOrdersForLocation(orders, {
    schemaVersion: 1,
    id: '',
    kind: 'table',
    label: normalizedTableCode,
    source: 'legacy_table_code',
  });
};

const EXTERNAL_ORIGIN_OPTIONS: Record<KyrubCommerceChannel, OrderOriginOption> = {
  mercado_livre: { id: 'marketplace:mercado_livre', label: 'Mercado Livre', group: 'marketplace' },
  '99food': { id: 'marketplace:99food', label: '99Food', group: 'marketplace' },
  shopee: { id: 'marketplace:shopee', label: 'Shopee', group: 'marketplace' },
  ifood: { id: 'marketplace:ifood', label: 'iFood', group: 'marketplace' },
  instagram: { id: 'marketplace:instagram', label: 'Instagram', group: 'marketplace' },
  erp: { id: 'marketplace:erp', label: 'ERP', group: 'marketplace' },
  other: { id: 'marketplace:other', label: 'Outro canal', group: 'marketplace' },
};

const KYRUB_ORIGIN_OPTION: OrderOriginOption = {
  id: 'kyrub:native',
  label: 'Kyrub',
  group: 'kyrub',
};

const PDV_ORIGIN_OPTION: OrderOriginOption = {
  id: 'internal:pdv',
  label: 'PDV / Staff',
  group: 'internal',
};

const INTERNAL_ORIGIN_OPTION: OrderOriginOption = {
  id: 'internal:operation',
  label: 'Operação interna',
  group: 'internal',
};

export const getOrderOrigin = (order: CustomerOrder): OrderOriginOption => {
  if (order.sourceChannel && order.sourceChannel !== 'kyrub') {
    return EXTERNAL_ORIGIN_OPTIONS[order.sourceChannel];
  }

  if (isNinetyNineFoodOrder(order)) {
    return EXTERNAL_ORIGIN_OPTIONS['99food'];
  }

  if (order.source === 'staff') {
    return PDV_ORIGIN_OPTION;
  }

  if (order.source === 'customer' || order.sourceChannel === 'kyrub') {
    return KYRUB_ORIGIN_OPTION;
  }

  return INTERNAL_ORIGIN_OPTION;
};

export const buildOrderOriginOptions = (
  _orders: CustomerOrder[],
  _attendanceSpaces: string[] = [],
  connectedChannels: KyrubCommerceChannel[] = []
): OrderOriginOption[] => {
  const connected = [...new Set(connectedChannels)]
    .map(channel => EXTERNAL_ORIGIN_OPTIONS[channel])
    .sort((left, right) => left.label.localeCompare(right.label, 'pt-BR'));
  return [KYRUB_ORIGIN_OPTION, PDV_ORIGIN_OPTION, ...connected];
};

const orderActivityAction = (
  nextStatus: CustomerOrderStatus,
  decision: OrderDecision
): string => decision.handoffCode ? 'pickup.handoff' : `order.status.${nextStatus}`;

const recordOrderActivity = (
  type: 'interaction.action_attempted' | 'result.action_succeeded' | 'result.action_failed',
  orderId: string,
  nextStatus: CustomerOrderStatus,
  decision: OrderDecision,
  source: 'client_observation' | 'authoritative_write_ack'
): void => {
  recordCurrentUserActivityEvent({
    type,
    domain: 'order',
    source,
    screenId: decision.handoffCode ? 'erp:retirada' : 'erp:pedidos',
    actionId: orderActivityAction(nextStatus, decision),
    entityType: 'order',
    entityId: orderId,
  });
};

const parseOrderStatusUpdateResult = (
  value: unknown,
  fallbackOrderId: string,
  fallbackStatus: CustomerOrderStatus
): OrderStatusUpdateResult => {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const partnerSync =
    candidate.partnerSync === 'authorization-required' ||
    candidate.partnerSync === 'sent' ||
    candidate.partnerSync === 'attention' ||
    candidate.partnerSync === 'reconciliation-required'
      ? candidate.partnerSync
      : 'not-applicable';
  return {
    orderId:
      typeof candidate.orderId === 'string' && candidate.orderId.trim()
        ? candidate.orderId.trim()
        : fallbackOrderId,
    status:
      typeof candidate.status === 'string'
        ? candidate.status as CustomerOrderStatus
        : fallbackStatus,
    provider: typeof candidate.provider === 'string' ? candidate.provider : '',
    externalOrderId:
      typeof candidate.externalOrderId === 'string' ? candidate.externalOrderId : '',
    partnerSync,
    partnerWarning:
      typeof candidate.partnerWarning === 'string' ? candidate.partnerWarning : '',
  };
};

const syncInitialNinetyNineFoodExternalStatus = async (
  user: User,
  result: OrderStatusUpdateResult
): Promise<OrderStatusUpdateResult> => {
  try {
    const pendingItems = await loadNinetyNineFoodPendingStatusSyncs(user);
    const item = pendingItems.find(candidate =>
      candidate.orderId === result.orderId && candidate.status === result.status
    );
    if (!item) {
      return {
        ...result,
        partnerSync: 'attention',
        partnerWarning: 'O status foi aplicado no Kyrub, mas a pendência autoritativa 99Food ainda não ficou disponível. Nenhuma escrita externa foi tentada; revise a fila 99Food antes de enviar.',
      };
    }

    const external = await sendNinetyNineFoodPendingStatusSync(user, item);
    return {
      ...result,
      externalOrderId: external.externalOrderId || result.externalOrderId,
      partnerSync: external.partnerSync === 'reconciliation_required'
        ? 'reconciliation-required'
        : external.partnerSync,
      partnerWarning: external.partnerWarning,
    };
  } catch (error) {
    return {
      ...result,
      partnerSync: 'attention',
      partnerWarning: error instanceof Error
        ? error.message
        : 'O status foi aplicado no Kyrub, mas a sincronização one-time com a 99Food não pôde ser concluída.',
    };
  }
};

export const updateOrderStatusWithDecision = async (
  storeId: string,
  orderId: string,
  nextStatus: CustomerOrderStatus,
  decision: OrderDecision = {}
): Promise<OrderStatusUpdateResult> => {
  const user = auth.currentUser;
  const normalizedStoreId = storeId.trim();
  const normalizedOrderId = orderId.trim();
  if (!user || user.uid !== normalizedStoreId) {
    throw new Error('Faça login novamente para atualizar o pedido.');
  }

  let syncWithNinetyNineFood = false;
  if (isNinetyNineFoodOrderId(normalizedOrderId)) {
    const choice = await requestNinetyNineFoodStatusWriteAuthority({
      storeId: normalizedStoreId,
      orderId: normalizedOrderId,
      status: nextStatus,
    });
    if (choice === 'cancel') {
      throw new Error('A atualização do pedido foi cancelada antes de qualquer alteração.');
    }
    syncWithNinetyNineFood = choice === 'kyrub_and_99food';
  }

  recordOrderActivity(
    'interaction.action_attempted',
    normalizedOrderId,
    nextStatus,
    decision,
    'client_observation'
  );

  try {
    const token = await user.getIdToken();
    const response = await fetch(
      `/api/orders/${encodeURIComponent(normalizedOrderId)}/status`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          status: nextStatus,
          decision,
        }),
      }
    );
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) {
      const localResult = parseOrderStatusUpdateResult(
        payload,
        normalizedOrderId,
        nextStatus
      );
      const result =
        syncWithNinetyNineFood &&
        (localResult.provider === '99food' || isNinetyNineFoodOrderId(normalizedOrderId))
          ? await syncInitialNinetyNineFoodExternalStatus(user, localResult)
          : localResult;
      recordOrderActivity(
        'result.action_succeeded',
        normalizedOrderId,
        nextStatus,
        decision,
        'authoritative_write_ack'
      );
      if (result.provider === '99food' || isNinetyNineFoodOrderId(normalizedOrderId)) {
        publishNinetyNineFoodStatusWriteResult({
          storeId: normalizedStoreId,
          orderId: result.orderId,
          status: result.status,
          partnerSync: result.partnerSync,
          partnerWarning: result.partnerWarning,
        });
      }
      return result;
    }
    recordOrderActivity(
      'result.action_failed',
      normalizedOrderId,
      nextStatus,
      decision,
      'client_observation'
    );
    throw new Error(
      typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível atualizar o pedido e o estoque.'
    );
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Não foi possível atualizar')) {
      recordOrderActivity(
        'result.action_failed',
        normalizedOrderId,
        nextStatus,
        decision,
        'client_observation'
      );
    }
    throw error;
  }
};

export const reviewAttendanceOrder = async (
  user: Pick<User, 'uid' | 'email' | 'displayName' | 'getIdToken'>,
  storeId: string,
  orderId: string,
  input: AttendanceReviewInput
): Promise<void> => {
  if (!storeId.trim() || user.uid !== storeId.trim()) {
    throw new Error('A loja autenticada não foi identificada.');
  }
  const token = await user.getIdToken();
  const response = await fetch(
    `/api/orders/${encodeURIComponent(orderId.trim())}/attendance-review`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    }
  );
  if (response.ok) return;
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  throw new Error(
    typeof payload.error === 'string'
      ? payload.error
      : 'Não foi possível revisar o pedido de autoatendimento.'
  );
};