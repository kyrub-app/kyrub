import { doc, runTransaction } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from './firebase';
import {
  canTransitionCustomerOrderStatus,
  getCustomerOrderDocumentPath,
  parseCustomerOrder,
  type CustomerOrder,
  type CustomerOrderItem,
  type CustomerOrderStatus,
} from './customerOrders';

export interface OrderDecision {
  reason?: string;
  alternative?: string;
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

const operatorLabel = (user: Pick<User, 'displayName' | 'email'>): string =>
  user.displayName?.trim() || user.email?.trim() || 'Staff Kyrub';

export const isPendingAttendanceApproval = (order: CustomerOrder): boolean =>
  order.source === 'customer' &&
  order.fulfillmentType === 'dine_in' &&
  Boolean(order.tableCode.trim()) &&
  order.status === 'pending' &&
  !order.operatorId.trim();

export const isOrderVisibleInKds = (order: CustomerOrder): boolean =>
  !isPendingAttendanceApproval(order);

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
  const buyerId = order.buyerId.toLocaleLowerCase('pt-BR');
  const operatorName = order.operatorName.toLocaleLowerCase('pt-BR');

  if (buyerId.startsWith('99food:') || operatorName.includes('99food')) {
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

const decisionText = (decision: OrderDecision): string => {
  const parts = [
    decision.reason?.trim()
      ? `Motivo da recusa: ${decision.reason.trim()}`
      : '',
    decision.alternative?.trim()
      ? `Alternativa sugerida: ${decision.alternative.trim()}`
      : '',
  ].filter(Boolean);
  return parts.join(' · ');
};

const mergeCustomerNote = (current: string, extra: string): string =>
  [current.trim(), extra.trim()].filter(Boolean).join('\n');

export const updateOrderStatusWithDecision = async (
  storeId: string,
  orderId: string,
  nextStatus: CustomerOrderStatus,
  decision: OrderDecision = {}
): Promise<void> => {
  const reference = doc(db, getCustomerOrderDocumentPath(storeId, orderId));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = parseCustomerOrder(snapshot.data());
    if (!current) throw new Error('Pedido não encontrado.');
    if (!canTransitionCustomerOrderStatus(current.status, nextStatus)) {
      throw new Error('Esta mudança de status não é permitida.');
    }

    const extra = decisionText(decision);
    transaction.update(reference, {
      status: nextStatus,
      ...(extra ? { customerNote: mergeCustomerNote(current.customerNote, extra) } : {}),
      updatedAt: new Date().toISOString(),
    });
  });
};

export const reviewAttendanceOrder = async (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  storeId: string,
  orderId: string,
  input: AttendanceReviewInput
): Promise<void> => {
  if (!storeId.trim() || user.uid !== storeId.trim()) {
    throw new Error('A loja autenticada não foi identificada.');
  }

  const reference = doc(db, getCustomerOrderDocumentPath(storeId, orderId));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const current = parseCustomerOrder(snapshot.data());
    if (!current) throw new Error('Pedido de autoatendimento não encontrado.');
    if (!isPendingAttendanceApproval(current)) {
      throw new Error('Este pedido já foi revisado pelo atendimento.');
    }

    if (input.action === 'reject') {
      const reason = input.reason?.trim() ?? '';
      if (!reason) throw new Error('Explique o motivo da recusa.');
      transaction.update(reference, {
        status: 'rejected',
        customerNote: mergeCustomerNote(
          current.customerNote,
          decisionText({ reason, alternative: input.alternative })
        ),
        operatorId: user.uid,
        operatorName: operatorLabel(user),
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const requested = new Map(
      input.items.map(item => [item.lineId, item] as const)
    );
    const items = current.items.flatMap(item => {
      const revision = requested.get(item.lineId);
      if (!revision) return [item];
      if (!Number.isInteger(revision.quantity) || revision.quantity < 0) {
        throw new Error(`Revise a quantidade de “${item.name}”.`);
      }
      if (revision.quantity === 0) return [];
      return [{
        ...item,
        quantity: revision.quantity,
        paidQuantity: Math.min(item.paidQuantity, revision.quantity),
        transferredQuantity: Math.min(
          item.transferredQuantity,
          Math.max(0, revision.quantity - item.paidQuantity)
        ),
        note: revision.note.trim(),
      } satisfies CustomerOrderItem];
    });

    if (items.length === 0) {
      throw new Error('Mantenha ao menos um item ou recuse o pedido.');
    }

    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    transaction.update(reference, {
      items,
      subtotal: total,
      total,
      customerNote: input.customerNote.trim(),
      status: 'pending',
      operatorId: user.uid,
      operatorName: operatorLabel(user),
      updatedAt: new Date().toISOString(),
    });
  });
};
