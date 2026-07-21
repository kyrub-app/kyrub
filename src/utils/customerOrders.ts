import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  setDoc,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CartItem } from '../types';
import { db } from './firebase';

export type CustomerFulfillmentType = 'delivery' | 'pickup' | 'dine_in';

export type CustomerOrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface CustomerOrderItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  note: string;
  image: string;
  isService: boolean;
}

export interface CustomerOrder {
  id: string;
  storeId: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  fulfillmentType: CustomerFulfillmentType;
  deliveryAddress: string;
  tableCode: string;
  customerNote: string;
  items: CustomerOrderItem[];
  subtotal: number;
  total: number;
  status: CustomerOrderStatus;
  paymentStatus: 'unpaid';
  createdAt: string;
  updatedAt: string;
}

export interface BuildCustomerOrderInput {
  storeId: string;
  buyerName: string;
  buyerEmail: string;
  fulfillmentType: CustomerFulfillmentType | '';
  deliveryAddress: string;
  tableCode: string;
  customerNote: string;
  cart: CartItem[];
  itemNotes: Record<string, string>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STATUS_TRANSITIONS: Record<CustomerOrderStatus, CustomerOrderStatus[]> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'completed'],
  out_for_delivery: ['completed'],
  completed: [],
  rejected: [],
  cancelled: [],
};

const cleanString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isFulfillmentType = (
  value: unknown
): value is CustomerFulfillmentType =>
  value === 'delivery' || value === 'pickup' || value === 'dine_in';

const isOrderStatus = (value: unknown): value is CustomerOrderStatus =>
  typeof value === 'string' && value in STATUS_TRANSITIONS;

export const getCustomerOrdersCollectionPath = (storeId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders`;

export const getCustomerOrderDocumentPath = (
  storeId: string,
  orderId: string
): string => `${getCustomerOrdersCollectionPath(storeId)}/${orderId}`;

export const getLastCustomerOrderStorageKey = (
  buyerId: string,
  storeId: string
): string => `kyrub_last_customer_order_${buyerId}_${storeId}`;

export const saveLastCustomerOrderId = (
  storage: StorageLike,
  buyerId: string,
  storeId: string,
  orderId: string
): void => {
  storage.setItem(getLastCustomerOrderStorageKey(buyerId, storeId), orderId);
};

export const loadLastCustomerOrderId = (
  storage: StorageLike,
  buyerId: string,
  storeId: string
): string =>
  storage.getItem(getLastCustomerOrderStorageKey(buyerId, storeId)) ?? '';

export const clearLastCustomerOrderId = (
  storage: StorageLike,
  buyerId: string,
  storeId: string
): void => {
  storage.removeItem(getLastCustomerOrderStorageKey(buyerId, storeId));
};

export const buildCustomerOrder = (
  user: Pick<User, 'uid'>,
  input: BuildCustomerOrderInput,
  now: number = Date.now()
): CustomerOrder => {
  const storeId = input.storeId.trim();
  const buyerName = input.buyerName.trim();
  const buyerEmail = input.buyerEmail.trim();

  if (!storeId) throw new Error('A loja não foi identificada.');
  if (!buyerName) throw new Error('Informe seu nome.');
  if (!buyerEmail) throw new Error('Informe seu e-mail.');
  if (!isFulfillmentType(input.fulfillmentType)) {
    throw new Error('Escolha entrega, retirada ou consumo no local.');
  }
  if (input.cart.length === 0) throw new Error('Seu carrinho está vazio.');

  const deliveryAddress = input.deliveryAddress.trim();
  const tableCode = input.tableCode.trim();

  if (input.fulfillmentType === 'delivery' && !deliveryAddress) {
    throw new Error('Informe o endereço de entrega.');
  }

  if (input.fulfillmentType === 'dine_in' && !tableCode) {
    throw new Error('Informe a mesa ou o código de atendimento.');
  }

  const items = input.cart.map(({ product, quantity }) => {
    const normalizedQuantity = Math.trunc(quantity);

    if (
      !Number.isFinite(quantity) ||
      !Number.isInteger(quantity) ||
      normalizedQuantity <= 0
    ) {
      throw new Error(`Revise a quantidade de “${product.name}”.`);
    }

    if (!Number.isFinite(product.price) || product.price < 0) {
      throw new Error(`O preço de “${product.name}” é inválido.`);
    }

    return {
      productId: product.id,
      name: product.name.trim(),
      price: product.price,
      quantity: normalizedQuantity,
      note: cleanString(input.itemNotes[product.id]),
      image: cleanString(product.image),
      isService: product.isService === true,
    } satisfies CustomerOrderItem;
  });

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );
  const timestamp = new Date(now).toISOString();

  return {
    id: `customer-order-${user.uid}-${now}`,
    storeId,
    buyerId: user.uid,
    buyerName,
    buyerEmail,
    fulfillmentType: input.fulfillmentType,
    deliveryAddress:
      input.fulfillmentType === 'delivery' ? deliveryAddress : '',
    tableCode: input.fulfillmentType === 'dine_in' ? tableCode : '',
    customerNote: input.customerNote.trim(),
    items,
    subtotal,
    total: subtotal,
    status: 'pending',
    paymentStatus: 'unpaid',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const parseCustomerOrder = (value: unknown): CustomerOrder | null => {
  if (!value || typeof value !== 'object') return null;

  const candidate = value as Record<string, unknown>;
  const id = cleanString(candidate.id);
  const storeId = cleanString(candidate.storeId);
  const buyerId = cleanString(candidate.buyerId);
  const buyerName = cleanString(candidate.buyerName);
  const buyerEmail = cleanString(candidate.buyerEmail);
  const subtotal = finiteNumber(candidate.subtotal);
  const total = finiteNumber(candidate.total);

  if (
    !id ||
    !storeId ||
    !buyerId ||
    !buyerName ||
    !buyerEmail ||
    !isFulfillmentType(candidate.fulfillmentType) ||
    !isOrderStatus(candidate.status) ||
    subtotal === null ||
    subtotal < 0 ||
    total === null ||
    total < 0 ||
    !Array.isArray(candidate.items)
  ) {
    return null;
  }

  const items = candidate.items.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const productId = cleanString(record.productId);
    const name = cleanString(record.name);
    const price = finiteNumber(record.price);
    const quantity = finiteNumber(record.quantity);

    if (
      !productId ||
      !name ||
      price === null ||
      price < 0 ||
      quantity === null ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return [];
    }

    return [{
      productId,
      name,
      price,
      quantity,
      note: cleanString(record.note),
      image: cleanString(record.image),
      isService: record.isService === true,
    } satisfies CustomerOrderItem];
  });

  if (items.length !== candidate.items.length || items.length === 0) return null;

  return {
    id,
    storeId,
    buyerId,
    buyerName,
    buyerEmail,
    fulfillmentType: candidate.fulfillmentType,
    deliveryAddress: cleanString(candidate.deliveryAddress),
    tableCode: cleanString(candidate.tableCode),
    customerNote: cleanString(candidate.customerNote),
    items,
    subtotal,
    total,
    status: candidate.status,
    paymentStatus: 'unpaid',
    createdAt: cleanString(candidate.createdAt),
    updatedAt: cleanString(candidate.updatedAt),
  };
};

export const persistCustomerOrder = async (
  order: CustomerOrder
): Promise<void> => {
  await setDoc(
    doc(db, getCustomerOrderDocumentPath(order.storeId, order.id)),
    order
  );
};

export const subscribeToCustomerOrder = (
  storeId: string,
  orderId: string,
  onOrder: (order: CustomerOrder | null) => void,
  onError?: (error: Error) => void
): (() => void) => {
  if (!storeId || !orderId) {
    onOrder(null);
    return () => undefined;
  }

  return onSnapshot(
    doc(db, getCustomerOrderDocumentPath(storeId, orderId)),
    snapshot => onOrder(parseCustomerOrder(snapshot.data())),
    error => {
      onOrder(null);
      onError?.(error);
    }
  );
};

export const subscribeToStoreCustomerOrders = (
  storeId: string,
  onOrders: (orders: CustomerOrder[]) => void,
  onError?: (error: Error) => void
): (() => void) => {
  if (!storeId) {
    onOrders([]);
    return () => undefined;
  }

  return onSnapshot(
    collection(db, getCustomerOrdersCollectionPath(storeId)),
    snapshot => {
      const orders = snapshot.docs
        .map(orderDocument => parseCustomerOrder(orderDocument.data()))
        .filter((order): order is CustomerOrder => order !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      onOrders(orders);
    },
    error => {
      onOrders([]);
      onError?.(error);
    }
  );
};

export const canTransitionCustomerOrderStatus = (
  current: CustomerOrderStatus,
  next: CustomerOrderStatus
): boolean => STATUS_TRANSITIONS[current].includes(next);

export const updateCustomerOrderStatus = async (
  storeId: string,
  orderId: string,
  nextStatus: CustomerOrderStatus
): Promise<void> => {
  const reference = doc(db, getCustomerOrderDocumentPath(storeId, orderId));

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    const currentOrder = parseCustomerOrder(snapshot.data());

    if (!currentOrder) throw new Error('Pedido não encontrado.');
    if (!canTransitionCustomerOrderStatus(currentOrder.status, nextStatus)) {
      throw new Error('Esta mudança de status não é permitida.');
    }

    transaction.update(reference, {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
  });
};

export const isTerminalCustomerOrderStatus = (
  status: CustomerOrderStatus
): boolean =>
  status === 'completed' || status === 'rejected' || status === 'cancelled';

export const getCustomerOrderStatusLabel = (
  status: CustomerOrderStatus
): string => {
  const labels: Record<CustomerOrderStatus, string> = {
    pending: 'Aguardando confirmação',
    accepted: 'Pedido aceito',
    preparing: 'Em preparação',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    completed: 'Concluído',
    rejected: 'Recusado',
    cancelled: 'Cancelado',
  };

  return labels[status];
};

export const getFulfillmentLabel = (
  fulfillmentType: CustomerFulfillmentType
): string => {
  const labels: Record<CustomerFulfillmentType, string> = {
    delivery: 'Entrega',
    pickup: 'Retirada',
    dine_in: 'Consumo no local',
  };

  return labels[fulfillmentType];
};
