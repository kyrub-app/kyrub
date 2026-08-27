import type { User } from 'firebase/auth';
import { auth } from './firebase';
import type {
  CustomerOrder,
  CustomerOrderStatus,
} from './customerOrders';
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
  group: 'attendance' | 'kyrub' | 'marketplace' | 'internal';
}

const normalize = (value: string): string =>
  value.trim().toLocaleUpperCase('pt-BR');

const isNinetyNineFoodOrder = (order: CustomerOrder): boolean =>
  order.buyerId.toLocaleLowerCase('pt-BR').startsWith('99food:') ||
  order.operatorName.toLocaleLowerCase('pt-BR').includes('99food');

export const isPendingAttendanceApproval = (order: CustomerOrder): boolean =>
  order.source === 'customer' &&
  order.fulfillmentType === 'dine_in' &&
  Boolean(order.tableCode.trim()) &&
  order.status === 'pending' &&
  !order.operatorId.trim();

export const isOrderVisibleInKds = (order: CustomerOrder): boolean => {
  if (isPendingAttendanceApproval(order)) return false;
  if (order.source !== 'customer') return true;
  if (order.fulfillmentType === 'dine_in') return true;
  if (isNinetyNineFoodOrder(order)) return true;
  return order.paymentStatus === 'paid';
};

export const getPendingAttendanceOrders = (
  orders: CustomerOrder[],
  tableCode: string
): CustomerOrder[] => {
  const expected = normalize(tableCode);
  return orders
    .filter(
      order =>
        isPendingAttendanceApproval(order) &&
        normalize(order.tableCode) === expected
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
};

const attendanceEnvironmentFor = (
  order: CustomerOrder,
  attendanceSpaces: string[]
): string => {
  const tableCode = normalize(order.tableCode);
  const configured = attendanceSpaces
    .map(normalize)
    .filter(space => space && space !== 'GERAL');
  return configured.find(space => tableCode.includes(space)) || 'ATENDIMENTO';
};

export const getOrderOrigin = (
  order: CustomerOrder,
  attendanceSpaces: string[] = []
): OrderOriginOption => {
  if (isNinetyNineFoodOrder(order)) {
    return { id: 'marketplace:99food', label: '99Food', group: 'marketplace' };
  }

  if (order.source === 'customer' && order.fulfillmentType === 'dine_in') {
    const environment = attendanceEnvironmentFor(order, attendanceSpaces);
    return {
      id: `attendance:${environment}`,
      label: environment === 'ATENDIMENTO' ? 'Atendimento presencial' : environment,
      group: 'attendance',
    };
  }

  if (order.source === 'customer') {
    return { id: 'kyrub:offers', label: 'Kyrub Ofertas', group: 'kyrub' };
  }

  if (order.source === 'staff') {
    return { id: 'internal:pdv', label: 'PDV / Staff', group: 'internal' };
  }

  return { id: 'marketplace:other', label: 'Outros canais', group: 'marketplace' };
};

export const buildOrderOriginOptions = (
  orders: CustomerOrder[],
  attendanceSpaces: string[] = []
): OrderOriginOption[] => {
  const unique = new Map<string, OrderOriginOption>();
  for (const order of orders) {
    const origin = getOrderOrigin(order, attendanceSpaces);
    unique.set(origin.id, origin);
  }
  return Array.from(unique.values()).sort((left, right) =>
    left.label.localeCompare(right.label, 'pt-BR')
  );
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

export const updateOrderStatusWithDecision = async (
  storeId: string,
  orderId: string,
  nextStatus: CustomerOrderStatus,
  decision: OrderDecision = {}
): Promise<void> => {
  const user = auth.currentUser;
  if (!user || user.uid !== storeId.trim()) {
    throw new Error('Faça login novamente para atualizar o pedido.');
  }

  recordOrderActivity(
    'interaction.action_attempted',
    orderId,
    nextStatus,
    decision,
    'client_observation'
  );

  try {
    const token = await user.getIdToken();
    const response = await fetch(
      `/api/orders/${encodeURIComponent(orderId.trim())}/status`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ status: nextStatus, decision }),
      }
    );
    if (response.ok) {
      recordOrderActivity(
        'result.action_succeeded',
        orderId,
        nextStatus,
        decision,
        'authoritative_write_ack'
      );
      return;
    }
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    recordOrderActivity(
      'result.action_failed',
      orderId,
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
        orderId,
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
