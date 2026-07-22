import type { CustomerOrder } from './customerOrders';
import {
  getStoreOrderDocumentPath,
  type OrderActorRole,
  type StoreRole,
} from './storeSecurity';

export interface CanonicalCustomerOrderRecord extends CustomerOrder {
  createdByUserId: string;
  createdByRole: OrderActorRole;
  migratedFromPath: string;
}

export interface CanonicalOrderActor {
  userId: string;
  role: StoreRole;
}

export const getLegacyCustomerOrderDocumentPath = (
  storeId: string,
  orderId: string
): string =>
  `artifacts/${storeId.trim()}/public/data/customerOrders/${orderId.trim()}`;

export const resolveCustomerOrderActor = (
  order: CustomerOrder,
  staffActor?: CanonicalOrderActor
): Pick<CanonicalCustomerOrderRecord, 'createdByUserId' | 'createdByRole'> => {
  if (order.source === 'customer') {
    return {
      createdByUserId: order.buyerId,
      createdByRole: 'customer',
    };
  }

  const userId = staffActor?.userId.trim() || order.operatorId.trim();
  const role = staffActor?.role;

  if (!userId || !role) {
    throw new Error(
      'Pedidos presenciais e transferências exigem operador e papel da loja.'
    );
  }

  return {
    createdByUserId: userId,
    createdByRole: role,
  };
};

export const toCanonicalCustomerOrder = (
  order: CustomerOrder,
  staffActor?: CanonicalOrderActor
): CanonicalCustomerOrderRecord => ({
  ...order,
  ...resolveCustomerOrderActor(order, staffActor),
  migratedFromPath: getLegacyCustomerOrderDocumentPath(order.storeId, order.id),
});

export const getCanonicalCustomerOrderWriteTarget = (
  order: Pick<CustomerOrder, 'storeId' | 'id'>
): string => getStoreOrderDocumentPath(order.storeId, order.id);

export const assertStoreIdIndependentFromOwner = (
  storeId: string,
  ownerUserId: string
): void => {
  if (!storeId.trim()) throw new Error('A loja precisa de um identificador próprio.');
  if (!ownerUserId.trim()) throw new Error('O proprietário precisa ser identificado.');
  if (storeId.trim() === ownerUserId.trim()) {
    throw new Error('O novo storeId não pode reutilizar o UID do proprietário.');
  }
};
