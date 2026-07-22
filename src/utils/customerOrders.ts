import {
  collection,
  doc,
  onSnapshot,
  runTransaction,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { CartItem } from '../types';
import { db } from './firebase';
import {
  chooseCanonicalReadSource,
  parseCanonicalReadConfig,
  recordCanonicalReadDecision,
  type CanonicalReadDecision,
} from './canonicalReadCutover';

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

export type CustomerOrderPaymentStatus = 'unpaid' | 'partial' | 'paid';
export type CustomerOrderSource = 'customer' | 'staff' | 'transfer';

export interface CustomerOrderItem {
  lineId: string;
  productId: string;
  name: string;
  price: number;
  quantity: number;
  paidQuantity: number;
  transferredQuantity: number;
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
  paymentStatus: CustomerOrderPaymentStatus;
  source: CustomerOrderSource;
  operatorId: string;
  operatorName: string;
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

export interface PreferredCustomerOrderResult {
  order: CustomerOrder | null;
  decision: CanonicalReadDecision;
  canonicalStoreId: string;
}

export interface PreferredCustomerOrdersResult {
  orders: CustomerOrder[];
  decision: CanonicalReadDecision;
  canonicalStoreId: string;
}

const STATUS_TRANSITIONS: Record<CustomerOrderStatus, CustomerOrderStatus[]> = {
  pending: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled', 'completed'],
  preparing: ['ready', 'cancelled', 'completed'],
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

const isOrderSource = (value: unknown): value is CustomerOrderSource =>
  value === 'customer' || value === 'staff' || value === 'transfer';

const isPaymentStatus = (
  value: unknown
): value is CustomerOrderPaymentStatus =>
  value === 'unpaid' || value === 'partial' || value === 'paid';

export const getCustomerOrdersCollectionPath = (storeId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders`;

export const getCustomerOrderDocumentPath = (
  storeId: string,
  orderId: string
): string => `${getCustomerOrdersCollectionPath(storeId)}/${orderId}`;

const getCanonicalOrdersCollectionPath = (storeId: string): string =>
  `stores/${storeId.trim()}/orders`;

const getCanonicalOrderDocumentPath = (
  storeId: string,
  orderId: string
): string => `${getCanonicalOrdersCollectionPath(storeId)}/${orderId.trim()}`;

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

export const getCustomerOrderItemOpenQuantity = (
  item: CustomerOrderItem
): number =>
  Math.max(0, item.quantity - item.paidQuantity - item.transferredQuantity);

export const getCustomerOrderOutstandingTotal = (
  order: Pick<CustomerOrder, 'items'>
): number =>
  order.items.reduce(
    (sum, item) => sum + getCustomerOrderItemOpenQuantity(item) * item.price,
    0
  );

export const resolveCustomerOrderPaymentStatus = (
  items: CustomerOrderItem[]
): CustomerOrderPaymentStatus => {
  const billableQuantity = items.reduce(
    (sum, item) => sum + Math.max(0, item.quantity - item.transferredQuantity),
    0
  );
  const paidQuantity = items.reduce((sum, item) => sum + item.paidQuantity, 0);

  if (billableQuantity === 0 || paidQuantity >= billableQuantity) return 'paid';
  if (paidQuantity > 0) return 'partial';
  return 'unpaid';
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

  const timestamp = new Date(now).toISOString();
  const orderId = `customer-order-${user.uid}-${now}`;
  const items = input.cart.map(({ product, quantity }, index) => {
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
      lineId: `${orderId}-line-${index + 1}`,
      productId: product.id,
      name: product.name.trim(),
      price: product.price,
      quantity: normalizedQuantity,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: cleanString(input.itemNotes[product.id]),
      image: cleanString(product.image),
      isService: product.isService === true,
    } satisfies CustomerOrderItem;
  });

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return {
    id: orderId,
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
    source: 'customer',
    operatorId: '',
    operatorName: '',
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
  const source = isOrderSource(candidate.source) ? candidate.source : 'customer';
  const buyerEmail = cleanString(candidate.buyerEmail);
  const subtotal = finiteNumber(candidate.subtotal);
  const total = finiteNumber(candidate.total);

  if (
    !id ||
    !storeId ||
    !buyerId ||
    !buyerName ||
    (source === 'customer' && !buyerEmail) ||
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

  const items = candidate.items.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const productId = cleanString(record.productId);
    const name = cleanString(record.name);
    const price = finiteNumber(record.price);
    const quantity = finiteNumber(record.quantity);
    const paidQuantity = finiteNumber(record.paidQuantity) ?? 0;
    const transferredQuantity = finiteNumber(record.transferredQuantity) ?? 0;

    if (
      !productId ||
      !name ||
      price === null ||
      price < 0 ||
      quantity === null ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isInteger(paidQuantity) ||
      paidQuantity < 0 ||
      !Number.isInteger(transferredQuantity) ||
      transferredQuantity < 0 ||
      paidQuantity + transferredQuantity > quantity
    ) {
      return [];
    }

    return [{
      lineId: cleanString(record.lineId) || `${id}-line-${index + 1}`,
      productId,
      name,
      price,
      quantity,
      paidQuantity,
      transferredQuantity,
      note: cleanString(record.note),
      image: cleanString(record.image),
      isService: record.isService === true,
    } satisfies CustomerOrderItem];
  });

  if (items.length !== candidate.items.length || items.length === 0) return null;

  const paymentStatus = isPaymentStatus(candidate.paymentStatus)
    ? candidate.paymentStatus
    : resolveCustomerOrderPaymentStatus(items);

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
    paymentStatus,
    source,
    operatorId: cleanString(candidate.operatorId),
    operatorName: cleanString(candidate.operatorName),
    createdAt: cleanString(candidate.createdAt),
    updatedAt: cleanString(candidate.updatedAt),
  };
};

const comparableOrder = (order: CustomerOrder) => ({
  id: order.id,
  buyerId: order.buyerId,
  fulfillmentType: order.fulfillmentType,
  tableCode: order.tableCode,
  subtotal: Number(order.subtotal.toFixed(2)),
  total: Number(order.total.toFixed(2)),
  status: order.status,
  paymentStatus: order.paymentStatus,
  source: order.source,
  items: order.items.map(item => ({
    lineId: item.lineId,
    productId: item.productId,
    price: Number(item.price.toFixed(2)),
    quantity: item.quantity,
    paidQuantity: item.paidQuantity,
    transferredQuantity: item.transferredQuantity,
    note: item.note,
  })),
});

export const customerOrderCollectionsEquivalent = (
  legacyOrders: CustomerOrder[],
  canonicalOrders: CustomerOrder[]
): boolean => {
  if (legacyOrders.length !== canonicalOrders.length) return false;
  const normalize = (orders: CustomerOrder[]) =>
    orders
      .map(comparableOrder)
      .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify(normalize(legacyOrders)) ===
    JSON.stringify(normalize(canonicalOrders));
};

export const customerOrdersEquivalent = (
  legacyOrder: CustomerOrder | null,
  canonicalOrder: CustomerOrder | null
): boolean => {
  if (!legacyOrder || !canonicalOrder) return legacyOrder === canonicalOrder;
  return JSON.stringify(comparableOrder(legacyOrder)) ===
    JSON.stringify(comparableOrder(canonicalOrder));
};

const mapCanonicalOrderToLegacyStore = (
  order: CustomerOrder | null,
  legacyStoreId: string
): CustomerOrder | null => order ? { ...order, storeId: legacyStoreId } : null;

export const persistCustomerOrder = async (
  order: CustomerOrder
): Promise<void> => {
  await setDoc(
    doc(db, getCustomerOrderDocumentPath(order.storeId, order.id)),
    order
  );
};

export const subscribeToPreferredCustomerOrder = (
  legacyStoreId: string,
  orderId: string,
  onResult: (result: PreferredCustomerOrderResult) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = legacyStoreId.trim();
  const normalizedOrderId = orderId.trim();
  if (!normalizedStoreId || !normalizedOrderId) {
    onResult({
      order: null,
      canonicalStoreId: '',
      decision: { source: 'legacy', reason: 'missing_mapping' },
    });
    return () => undefined;
  }

  let legacyOrder: CustomerOrder | null = null;
  let canonicalOrder: CustomerOrder | null = null;
  let legacyState: 'waiting' | 'available' | 'unavailable' = 'waiting';
  let canonicalState: 'waiting' | 'available' | 'unavailable' = 'waiting';
  let canonicalStoreId = '';
  let canonicalEnabled = false;
  let unsubscribeCanonical: Unsubscribe = () => undefined;

  const publish = (): void => {
    const equivalent =
      legacyState === 'unavailable' ||
      (legacyState === 'available' &&
        customerOrdersEquivalent(legacyOrder, canonicalOrder));
    const decision = chooseCanonicalReadSource(
      canonicalEnabled,
      canonicalStoreId,
      canonicalState,
      equivalent
    );
    recordCanonicalReadDecision(normalizedStoreId, 'orders', decision);
    onResult({
      order: decision.source === 'canonical' ? canonicalOrder : legacyOrder,
      decision,
      canonicalStoreId,
    });
  };

  const restartCanonical = (): void => {
    unsubscribeCanonical();
    unsubscribeCanonical = () => undefined;
    canonicalOrder = null;
    canonicalState = 'waiting';
    if (!canonicalEnabled || !canonicalStoreId) {
      publish();
      return;
    }
    publish();
    unsubscribeCanonical = onSnapshot(
      doc(db, getCanonicalOrderDocumentPath(canonicalStoreId, normalizedOrderId)),
      snapshot => {
        canonicalOrder = mapCanonicalOrderToLegacyStore(
          parseCustomerOrder(snapshot.data()),
          normalizedStoreId
        );
        canonicalState = 'available';
        publish();
      },
      error => {
        canonicalState = 'unavailable';
        publish();
        onError?.(error);
      }
    );
  };

  const unsubscribeLegacy = onSnapshot(
    doc(db, getCustomerOrderDocumentPath(normalizedStoreId, normalizedOrderId)),
    snapshot => {
      legacyOrder = parseCustomerOrder(snapshot.data());
      legacyState = 'available';
      publish();
    },
    error => {
      legacyState = 'unavailable';
      publish();
      onError?.(error);
    }
  );

  const unsubscribeConfig = onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => {
      const previousStoreId = canonicalStoreId;
      const previousEnabled = canonicalEnabled;
      const config = parseCanonicalReadConfig(snapshot.data());
      canonicalStoreId = config.canonicalStoreId;
      canonicalEnabled = config.preferences.orders;
      if (
        canonicalStoreId !== previousStoreId ||
        canonicalEnabled !== previousEnabled
      ) {
        restartCanonical();
      } else {
        publish();
      }
    },
    error => {
      canonicalEnabled = false;
      publish();
      onError?.(error);
    }
  );

  return () => {
    unsubscribeLegacy();
    unsubscribeConfig();
    unsubscribeCanonical();
  };
};

export const subscribeToCustomerOrder = (
  storeId: string,
  orderId: string,
  onOrder: (order: CustomerOrder | null) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  subscribeToPreferredCustomerOrder(
    storeId,
    orderId,
    result => onOrder(result.order),
    onError
  );

export const subscribeToPreferredStoreCustomerOrders = (
  legacyStoreId: string,
  onResult: (result: PreferredCustomerOrdersResult) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const normalizedStoreId = legacyStoreId.trim();
  if (!normalizedStoreId) {
    onResult({
      orders: [],
      canonicalStoreId: '',
      decision: { source: 'legacy', reason: 'missing_mapping' },
    });
    return () => undefined;
  }

  let legacyOrders: CustomerOrder[] = [];
  let canonicalOrders: CustomerOrder[] = [];
  let legacyState: 'waiting' | 'available' | 'unavailable' = 'waiting';
  let canonicalState: 'waiting' | 'available' | 'unavailable' = 'waiting';
  let canonicalStoreId = '';
  let canonicalEnabled = false;
  let unsubscribeCanonical: Unsubscribe = () => undefined;

  const publish = (): void => {
    const equivalent =
      legacyState === 'unavailable' ||
      (legacyState === 'available' &&
        customerOrderCollectionsEquivalent(legacyOrders, canonicalOrders));
    const decision = chooseCanonicalReadSource(
      canonicalEnabled,
      canonicalStoreId,
      canonicalState,
      equivalent
    );
    recordCanonicalReadDecision(normalizedStoreId, 'orders', decision);
    onResult({
      orders: decision.source === 'canonical' ? canonicalOrders : legacyOrders,
      decision,
      canonicalStoreId,
    });
  };

  const restartCanonical = (): void => {
    unsubscribeCanonical();
    unsubscribeCanonical = () => undefined;
    canonicalOrders = [];
    canonicalState = 'waiting';
    if (!canonicalEnabled || !canonicalStoreId) {
      publish();
      return;
    }
    publish();
    unsubscribeCanonical = onSnapshot(
      collection(db, getCanonicalOrdersCollectionPath(canonicalStoreId)),
      snapshot => {
        canonicalOrders = snapshot.docs
          .flatMap(document => {
            const parsed = mapCanonicalOrderToLegacyStore(
              parseCustomerOrder(document.data()),
              normalizedStoreId
            );
            return parsed ? [parsed] : [];
          })
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        canonicalState = 'available';
        publish();
      },
      error => {
        canonicalState = 'unavailable';
        publish();
        onError?.(error);
      }
    );
  };

  const unsubscribeLegacy = onSnapshot(
    collection(db, getCustomerOrdersCollectionPath(normalizedStoreId)),
    snapshot => {
      legacyOrders = snapshot.docs
        .map(orderDocument => parseCustomerOrder(orderDocument.data()))
        .filter((order): order is CustomerOrder => order !== null)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      legacyState = 'available';
      publish();
    },
    error => {
      legacyState = 'unavailable';
      publish();
      onError?.(error);
    }
  );

  const unsubscribeConfig = onSnapshot(
    doc(db, 'tenants', normalizedStoreId),
    snapshot => {
      const previousStoreId = canonicalStoreId;
      const previousEnabled = canonicalEnabled;
      const config = parseCanonicalReadConfig(snapshot.data());
      canonicalStoreId = config.canonicalStoreId;
      canonicalEnabled = config.preferences.orders;
      if (
        canonicalStoreId !== previousStoreId ||
        canonicalEnabled !== previousEnabled
      ) {
        restartCanonical();
      } else {
        publish();
      }
    },
    error => {
      canonicalEnabled = false;
      publish();
      onError?.(error);
    }
  );

  return () => {
    unsubscribeLegacy();
    unsubscribeConfig();
    unsubscribeCanonical();
  };
};

export const subscribeToStoreCustomerOrders = (
  storeId: string,
  onOrders: (orders: CustomerOrder[]) => void,
  onError?: (error: Error) => void
): Unsubscribe =>
  subscribeToPreferredStoreCustomerOrders(
    storeId,
    result => onOrders(result.orders),
    onError
  );

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

export const getCustomerOrderPaymentStatusLabel = (
  status: CustomerOrderPaymentStatus
): string => {
  const labels: Record<CustomerOrderPaymentStatus, string> = {
    unpaid: 'Não pago',
    partial: 'Parcialmente pago',
    paid: 'Pago',
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
