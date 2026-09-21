import { collection, doc, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Product } from '../types';
import { db } from './firebase';
import type { StorePromotionQuote } from './storePromotions';
import {
  getCustomerOrderDocumentPath,
  getCustomerOrderItemOpenQuantity,
  getCustomerOrderItemOutstandingAmount,
  getCustomerOrderOutstandingTotal,
  isTerminalCustomerOrderStatus,
  parseCustomerOrder,
  persistCustomerOrder,
  resolveCustomerOrderPaymentStatus,
  type CustomerOrder,
  type CustomerOrderItem,
  type CustomerOrderStatus,
} from './customerOrders';

export type TablePaymentMethod = 'cash' | 'pix' | 'card' | 'other';

export interface StaffTableCartItem {
  product: Product;
  quantity: number;
  note: string;
}

export interface BuildStaffTableOrderInput {
  storeId: string;
  tableCode: string;
  buyerName: string;
  customerNote: string;
  items: StaffTableCartItem[];
}

export interface TableItemSelection {
  orderId: string;
  lineId: string;
  quantity: number;
}

export interface TableOpenLine {
  key: string;
  orderId: string;
  lineId: string;
  productId: string;
  name: string;
  note: string;
  price: number;
  outstandingAmount: number;
  availableQuantity: number;
  buyerName: string;
  orderStatus: CustomerOrderStatus;
  createdAt: string;
}

export interface AppliedTablePayment {
  updatedOrders: CustomerOrder[];
  amount: number;
  quantity: number;
  items: Array<{
    orderId: string;
    lineId: string;
    productId: string;
    name: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

export interface AppliedTableTransfer {
  updatedSourceOrders: CustomerOrder[];
  targetOrders: CustomerOrder[];
  amount: number;
  quantity: number;
}

export interface TableSettlementEntry {
  id: string;
  kind: 'payment' | 'discount';
  tableCode: string;
  method: TablePaymentMethod | 'coupon';
  amount: number;
  status: 'confirmed' | 'applied';
  couponCode: string;
  title: string;
  operatorName: string;
  createdAt: string;
}

export interface TableItemExclusionReceipt {
  exclusionId: string;
  orderId: string;
  lineId: string;
  tableCode: string;
  productId: string;
  itemName: string;
  quantity: number;
  amount: number;
  createdAt: string;
}

interface RegisterTablePaymentInput {
  storeId: string;
  tableCode: string;
  selections: TableItemSelection[];
  method: TablePaymentMethod;
  coupon?: StorePromotionQuote;
}

interface RegisterPartialTablePaymentInput {
  storeId: string;
  tableCode: string;
  selections: TableItemSelection[];
  method: Exclude<TablePaymentMethod, 'pix'>;
  amount: number;
}

interface ApplyTableCouponInput {
  storeId: string;
  tableCode: string;
  selections: TableItemSelection[];
  quote: StorePromotionQuote;
}

interface TransferTableItemsInput {
  storeId: string;
  sourceTableCode: string;
  targetTableCode: string;
  selections: TableItemSelection[];
}

interface ExcludeTableItemInput {
  storeId: string;
  tableCode: string;
  orderId: string;
  lineId: string;
}

const normalizeTableCode = (value: string): string => value.trim();
const tableKey = (value: string): string =>
  normalizeTableCode(value).toLocaleLowerCase('pt-BR');
const roundMoney = (value: number): number => Math.round(value * 100) / 100;

const operatorNameFor = (
  user: Pick<User, 'displayName' | 'email'>
): string => user.displayName?.trim() || user.email?.trim() || 'Operador';

const validateSelection = (selection: TableItemSelection): void => {
  if (!selection.orderId.trim() || !selection.lineId.trim()) {
    throw new Error('Seleção de item inválida.');
  }
  if (!Number.isInteger(selection.quantity) || selection.quantity <= 0) {
    throw new Error('Informe uma quantidade válida.');
  }
};

const groupSelections = (
  selections: TableItemSelection[]
): Map<string, Map<string, number>> => {
  const grouped = new Map<string, Map<string, number>>();

  selections.forEach(selection => {
    validateSelection(selection);
    const orderSelections = grouped.get(selection.orderId) ?? new Map<string, number>();
    orderSelections.set(
      selection.lineId,
      (orderSelections.get(selection.lineId) ?? 0) + selection.quantity
    );
    grouped.set(selection.orderId, orderSelections);
  });

  if (grouped.size === 0) throw new Error('Selecione ao menos um item.');
  return grouped;
};

export const getActiveTableOrders = (
  orders: CustomerOrder[],
  tableCode: string
): CustomerOrder[] => {
  const expectedTableKey = tableKey(tableCode);

  return orders.filter(
    order =>
      order.fulfillmentType === 'dine_in' &&
      tableKey(order.tableCode) === expectedTableKey &&
      !isTerminalCustomerOrderStatus(order.status) &&
      order.items.some(item => getCustomerOrderItemOpenQuantity(item) > 0)
  );
};

export const getTableOpenLines = (
  orders: CustomerOrder[],
  tableCode: string
): TableOpenLine[] =>
  getActiveTableOrders(orders, tableCode)
    .flatMap(order =>
      order.items.flatMap(item => {
        const availableQuantity = getCustomerOrderItemOpenQuantity(item);
        if (availableQuantity <= 0) return [];

        return [{
          key: `${order.id}:${item.lineId}`,
          orderId: order.id,
          lineId: item.lineId,
          productId: item.productId,
          name: item.name,
          note: item.note,
          price: item.price,
          outstandingAmount: getCustomerOrderItemOutstandingAmount(item),
          availableQuantity,
          buyerName: order.buyerName,
          orderStatus: order.status,
          createdAt: order.createdAt,
        } satisfies TableOpenLine];
      })
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

export const getTableOutstandingTotal = (
  orders: CustomerOrder[],
  tableCode: string
): number =>
  getActiveTableOrders(orders, tableCode).reduce(
    (sum, order) => sum + getCustomerOrderOutstandingTotal(order),
    0
  );

export const buildStaffTableOrder = (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  input: BuildStaffTableOrderInput,
  now: number = Date.now()
): CustomerOrder => {
  const storeId = input.storeId.trim();
  const tableCode = normalizeTableCode(input.tableCode);

  if (!storeId || user.uid !== storeId) {
    throw new Error('A loja autenticada não foi identificada.');
  }
  if (!tableCode) throw new Error('Informe a mesa ou código.');
  if (input.items.length === 0) throw new Error('Adicione itens ao pedido.');

  const orderId = `staff-order-${user.uid}-${now}`;
  const timestamp = new Date(now).toISOString();
  const items = input.items.map(({ product, quantity, note }, index) => {
    if (
      product.supplierId !== storeId ||
      !Number.isFinite(product.price) ||
      product.price < 0
    ) {
      throw new Error(`O produto “${product.name}” não pertence a esta loja.`);
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error(`Revise a quantidade de “${product.name}”.`);
    }

    return {
      lineId: `${orderId}-line-${index + 1}`,
      productId: product.id,
      name: product.name.trim(),
      price: product.price,
      quantity,
      paidQuantity: 0,
      transferredQuantity: 0,
      voidedQuantity: 0,
      settledAmount: 0,
      discountAmount: 0,
      note: note.trim(),
      image: product.image.trim(),
      isService: product.isService === true,
    } satisfies CustomerOrderItem;
  });
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return {
    id: orderId,
    storeId,
    buyerId: `walk-in-${tableKey(tableCode)}`,
    buyerName: input.buyerName.trim() || 'Atendimento presencial',
    buyerEmail: '',
    fulfillmentType: 'dine_in',
    deliveryAddress: '',
    tableCode,
    customerNote: input.customerNote.trim(),
    items,
    subtotal: total,
    total,
    status: 'accepted',
    paymentStatus: 'unpaid',
    source: 'staff',
    sourceChannel: 'kyrub',
    operatorId: user.uid,
    operatorName: operatorNameFor(user),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

export const createStaffTableOrder = async (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  input: BuildStaffTableOrderInput
): Promise<CustomerOrder> => {
  const order = buildStaffTableOrder(user, input);
  await persistCustomerOrder(order);
  return order;
};

export const applyTablePaymentSelections = (
  orders: CustomerOrder[],
  tableCode: string,
  selections: TableItemSelection[],
  now: number = Date.now()
): AppliedTablePayment => {
  const grouped = groupSelections(selections);
  const expectedTableKey = tableKey(tableCode);
  const timestamp = new Date(now).toISOString();
  let amount = 0;
  let quantity = 0;
  const settledItems: AppliedTablePayment['items'] = [];

  const updatedOrders = orders.map(order => {
    const orderSelections = grouped.get(order.id);
    if (!orderSelections) return order;
    if (
      order.fulfillmentType !== 'dine_in' ||
      tableKey(order.tableCode) !== expectedTableKey ||
      isTerminalCustomerOrderStatus(order.status)
    ) {
      throw new Error('O pedido selecionado não está ativo nesta mesa.');
    }

    const nextItems = order.items.map(item => {
      const selectedQuantity = orderSelections.get(item.lineId) ?? 0;
      if (selectedQuantity === 0) return item;

      const availableQuantity = getCustomerOrderItemOpenQuantity(item);
      if (selectedQuantity > availableQuantity) {
        throw new Error(`Quantidade indisponível para “${item.name}”.`);
      }

      amount += selectedQuantity * item.price;
      quantity += selectedQuantity;
      settledItems.push({
        orderId: order.id,
        lineId: item.lineId,
        productId: item.productId,
        name: item.name,
        quantity: selectedQuantity,
        unitPrice: item.price,
        total: selectedQuantity * item.price,
      });

      return {
        ...item,
        paidQuantity: item.paidQuantity + selectedQuantity,
      };
    });

    orderSelections.forEach((_, lineId) => {
      if (!order.items.some(item => item.lineId === lineId)) {
        throw new Error('Um dos itens selecionados não foi encontrado.');
      }
    });

    const allItemsClosed = nextItems.every(
      item => getCustomerOrderItemOpenQuantity(item) === 0
    );

    return {
      ...order,
      items: nextItems,
      paymentStatus: resolveCustomerOrderPaymentStatus(nextItems),
      status: allItemsClosed ? 'completed' : order.status,
      updatedAt: timestamp,
    };
  });

  grouped.forEach((_, orderId) => {
    if (!orders.some(order => order.id === orderId)) {
      throw new Error('Um dos pedidos selecionados não foi encontrado.');
    }
  });

  return { updatedOrders, amount, quantity, items: settledItems };
};

export const registerTablePayment = async (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  input: RegisterTablePaymentInput
): Promise<AppliedTablePayment> => {
  if (user.uid !== input.storeId) {
    throw new Error('Somente a loja autenticada pode fechar esta conta.');
  }

  const grouped = groupSelections(input.selections);
  const orderReferences = Array.from(grouped.keys()).map(orderId =>
    doc(db, getCustomerOrderDocumentPath(input.storeId, orderId))
  );
  const paymentReference = doc(
    collection(
      db,
      `artifacts/${input.storeId}/public/data/tablePayments`
    )
  );
  let result: AppliedTablePayment | null = null;

  await runTransaction(db, async transaction => {
    const snapshots = await Promise.all(
      orderReferences.map(reference => transaction.get(reference))
    );
    const orders = snapshots.map(snapshot => parseCustomerOrder(snapshot.data()));

    if (orders.some(order => order === null)) {
      throw new Error('Não foi possível carregar todos os itens da conta.');
    }

    const applied = applyTablePaymentSelections(
      orders as CustomerOrder[],
      input.tableCode,
      input.selections
    );
    const selectedSubtotal = roundMoney(applied.amount);
    const coupon = input.coupon;
    let paymentAmount = selectedSubtotal;
    let discountAmount = 0;

    if (coupon) {
      const quotedSubtotal = roundMoney(coupon.subtotal);
      const quotedDiscount = roundMoney(coupon.discountTotal);
      const quotedTotal = roundMoney(coupon.total);
      if (
        !coupon.code.trim() ||
        !Number.isFinite(quotedSubtotal) ||
        !Number.isFinite(quotedDiscount) ||
        !Number.isFinite(quotedTotal) ||
        quotedDiscount < 0 ||
        quotedTotal < 0 ||
        Math.abs(quotedSubtotal - selectedSubtotal) > 0.009 ||
        Math.abs(roundMoney(quotedSubtotal - quotedDiscount) - quotedTotal) > 0.009
      ) {
        throw new Error('O saldo selecionado mudou. Aplique o cupom novamente.');
      }
      discountAmount = quotedDiscount;
      paymentAmount = quotedTotal;
    }
    result = { ...applied, amount: paymentAmount };

    applied.updatedOrders.forEach(order => {
      transaction.update(
        doc(db, getCustomerOrderDocumentPath(input.storeId, order.id)),
        {
          items: order.items,
          paymentStatus: order.paymentStatus,
          status: order.status,
          updatedAt: order.updatedAt,
        }
      );
    });

    transaction.set(paymentReference, {
      id: paymentReference.id,
      storeId: input.storeId,
      tableCode: normalizeTableCode(input.tableCode),
      method: input.method,
      amount: paymentAmount,
      originalAmount: selectedSubtotal,
      discountAmount,
      couponCode: coupon?.code ?? '',
      couponTitle: coupon?.title ?? '',
      promotionId: coupon?.promotionId ?? '',
      quantity: applied.quantity,
      items: applied.items,
      operatorId: user.uid,
      operatorName: operatorNameFor(user),
      createdAt: new Date().toISOString(),
    });
  });

  if (!result) throw new Error('Não foi possível registrar o pagamento.');
  return result;
};

const selectedOutstandingCapacity = (
  item: CustomerOrderItem,
  selectedQuantity: number
): number => {
  const availableQuantity = getCustomerOrderItemOpenQuantity(item);
  if (selectedQuantity > availableQuantity) {
    throw new Error(`Quantidade indisponível para “${item.name}”.`);
  }
  const outstandingAmount = getCustomerOrderItemOutstandingAmount(item);
  return roundMoney(
    selectedQuantity >= availableQuantity
      ? outstandingAmount
      : Math.min(outstandingAmount, selectedQuantity * item.price)
  );
};

export const registerTablePartialPayment = async (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  input: RegisterPartialTablePaymentInput
): Promise<AppliedTablePayment> => {
  if (user.uid !== input.storeId) {
    throw new Error('Somente a loja autenticada pode receber esta conta.');
  }
  const requestedAmount = roundMoney(input.amount);
  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    throw new Error('Informe um valor válido para receber agora.');
  }

  const grouped = groupSelections(input.selections);
  const orderReferences = Array.from(grouped.keys()).map(orderId =>
    doc(db, getCustomerOrderDocumentPath(input.storeId, orderId))
  );
  const paymentReference = doc(
    collection(db, `artifacts/${input.storeId}/public/data/tablePayments`)
  );
  let result: AppliedTablePayment | null = null;

  await runTransaction(db, async transaction => {
    const snapshots = await Promise.all(orderReferences.map(reference => transaction.get(reference)));
    const orders = snapshots.map(snapshot => parseCustomerOrder(snapshot.data()));
    if (orders.some(order => order === null)) {
      throw new Error('Não foi possível carregar todos os itens da conta.');
    }

    const timestamp = new Date().toISOString();
    const expectedTableKey = tableKey(input.tableCode);
    let capacity = 0;
    for (const order of orders as CustomerOrder[]) {
      const orderSelections = grouped.get(order.id);
      if (!orderSelections) continue;
      if (
        order.fulfillmentType !== 'dine_in' ||
        tableKey(order.tableCode) !== expectedTableKey ||
        isTerminalCustomerOrderStatus(order.status)
      ) {
        throw new Error('O pedido selecionado não está ativo nesta mesa.');
      }
      orderSelections.forEach((selectedQuantity, lineId) => {
        const item = order.items.find(candidate => candidate.lineId === lineId);
        if (!item) throw new Error('Um dos itens selecionados não foi encontrado.');
        capacity += selectedOutstandingCapacity(item, selectedQuantity);
      });
    }
    capacity = roundMoney(capacity);
    if (requestedAmount > capacity + 0.009) {
      throw new Error('O valor informado é maior que o saldo selecionado.');
    }

    let remaining = requestedAmount;
    let selectedQuantityTotal = 0;
    const settledItems: AppliedTablePayment['items'] = [];
    const updatedOrders = (orders as CustomerOrder[]).map(order => {
      const orderSelections = grouped.get(order.id);
      if (!orderSelections) return order;
      const nextItems = order.items.map(item => {
        const selectedQuantity = orderSelections.get(item.lineId) ?? 0;
        if (selectedQuantity <= 0) return item;
        const lineCapacity = selectedOutstandingCapacity(item, selectedQuantity);
        const allocated = roundMoney(Math.min(lineCapacity, remaining));
        selectedQuantityTotal += selectedQuantity;
        if (allocated > 0) {
          settledItems.push({
            orderId: order.id,
            lineId: item.lineId,
            productId: item.productId,
            name: item.name,
            quantity: selectedQuantity,
            unitPrice: item.price,
            total: allocated,
          });
          remaining = roundMoney(remaining - allocated);
        }
        return allocated > 0
          ? { ...item, settledAmount: roundMoney((item.settledAmount ?? 0) + allocated) }
          : item;
      });
      const paymentStatus = resolveCustomerOrderPaymentStatus(nextItems);
      const allItemsClosed = nextItems.every(item => getCustomerOrderItemOutstandingAmount(item) <= 0.009);
      return {
        ...order,
        items: nextItems,
        paymentStatus,
        status: allItemsClosed ? 'completed' : order.status,
        updatedAt: timestamp,
      };
    });

    if (remaining > 0.009) throw new Error('Não foi possível alocar todo o valor informado.');
    updatedOrders.forEach(order => {
      transaction.update(doc(db, getCustomerOrderDocumentPath(input.storeId, order.id)), {
        items: order.items,
        paymentStatus: order.paymentStatus,
        status: order.status,
        updatedAt: order.updatedAt,
      });
    });
    transaction.set(paymentReference, {
      id: paymentReference.id,
      entryType: 'payment',
      status: 'confirmed',
      storeId: input.storeId,
      tableCode: normalizeTableCode(input.tableCode),
      method: input.method,
      amount: requestedAmount,
      originalAmount: requestedAmount,
      discountAmount: 0,
      couponCode: '',
      couponTitle: '',
      promotionId: '',
      quantity: selectedQuantityTotal,
      items: settledItems,
      operatorId: user.uid,
      operatorName: operatorNameFor(user),
      createdAt: timestamp,
    });
    result = {
      updatedOrders,
      amount: requestedAmount,
      quantity: selectedQuantityTotal,
      items: settledItems,
    };
  });

  if (!result) throw new Error('Não foi possível registrar o pagamento parcial.');
  return result;
};

export const applyTableCoupon = async (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  input: ApplyTableCouponInput
): Promise<TableSettlementEntry> => {
  if (user.uid !== input.storeId) {
    throw new Error('Somente a loja autenticada pode aplicar cupom nesta conta.');
  }
  const grouped = groupSelections(input.selections);
  const quote = input.quote;
  const discountTotal = roundMoney(quote.discountTotal);
  if (!quote.code.trim() || discountTotal <= 0) throw new Error('O cupom não gerou desconto válido.');
  const orderReferences = Array.from(grouped.keys()).map(orderId =>
    doc(db, getCustomerOrderDocumentPath(input.storeId, orderId))
  );
  const ledgerReference = doc(
    collection(db, `artifacts/${input.storeId}/public/data/tablePayments`)
  );
  let receipt: TableSettlementEntry | null = null;

  await runTransaction(db, async transaction => {
    const snapshots = await Promise.all(orderReferences.map(reference => transaction.get(reference)));
    const orders = snapshots.map(snapshot => parseCustomerOrder(snapshot.data()));
    if (orders.some(order => order === null)) throw new Error('Não foi possível carregar a conta.');
    const typedOrders = orders as CustomerOrder[];
    const expectedTableKey = tableKey(input.tableCode);
    let selectedSubtotal = 0;
    const eligible: Array<{ orderId: string; lineId: string; amount: number }> = [];

    for (const order of typedOrders) {
      if (
        order.fulfillmentType !== 'dine_in' ||
        tableKey(order.tableCode) !== expectedTableKey ||
        isTerminalCustomerOrderStatus(order.status)
      ) throw new Error('O pedido selecionado não está ativo nesta mesa.');
      if (order.items.some(item => item.paidQuantity > 0 || (item.settledAmount ?? 0) > 0.009)) {
        throw new Error('O cupom deve ser definido antes do primeiro pagamento da conta.');
      }
      const selections = grouped.get(order.id);
      if (!selections) continue;
      selections.forEach((selectedQuantity, lineId) => {
        const item = order.items.find(candidate => candidate.lineId === lineId);
        if (!item) throw new Error('Um dos itens selecionados não foi encontrado.');
        if ((item.discountAmount ?? 0) > 0.009) throw new Error('Já existe desconto aplicado nesta conta.');
        if (selectedQuantity > getCustomerOrderItemOpenQuantity(item)) {
          throw new Error(`Quantidade indisponível para “${item.name}”.`);
        }
        const lineAmount = roundMoney(selectedQuantity * item.price);
        selectedSubtotal += lineAmount;
        if (quote.eligibleProductIds.includes(item.productId)) {
          eligible.push({ orderId: order.id, lineId: item.lineId, amount: lineAmount });
        }
      });
    }
    selectedSubtotal = roundMoney(selectedSubtotal);
    if (Math.abs(roundMoney(quote.subtotal) - selectedSubtotal) > 0.009) {
      throw new Error('O saldo selecionado mudou. Aplique o cupom novamente.');
    }
    const eligibleTotal = roundMoney(eligible.reduce((sum, item) => sum + item.amount, 0));
    if (eligibleTotal <= 0 || discountTotal > eligibleTotal + 0.009) {
      throw new Error('O desconto não pode ser aplicado aos itens selecionados.');
    }

    let remainingDiscount = discountTotal;
    const allocations = new Map<string, number>();
    eligible.forEach((entry, index) => {
      const isLast = index === eligible.length - 1;
      const proportional = isLast
        ? remainingDiscount
        : roundMoney(discountTotal * (entry.amount / eligibleTotal));
      const allocated = roundMoney(Math.min(entry.amount, proportional, remainingDiscount));
      allocations.set(`${entry.orderId}:${entry.lineId}`, allocated);
      remainingDiscount = roundMoney(remainingDiscount - allocated);
    });
    if (remainingDiscount > 0.009 && eligible.length) {
      const last = eligible[eligible.length - 1];
      const key = `${last.orderId}:${last.lineId}`;
      allocations.set(key, roundMoney((allocations.get(key) ?? 0) + remainingDiscount));
      remainingDiscount = 0;
    }

    const timestamp = new Date().toISOString();
    typedOrders.forEach(order => {
      const nextItems = order.items.map(item => {
        const allocation = allocations.get(`${order.id}:${item.lineId}`) ?? 0;
        return allocation > 0
          ? { ...item, discountAmount: roundMoney((item.discountAmount ?? 0) + allocation) }
          : item;
      });
      transaction.update(doc(db, getCustomerOrderDocumentPath(input.storeId, order.id)), {
        items: nextItems,
        paymentStatus: resolveCustomerOrderPaymentStatus(nextItems),
        updatedAt: timestamp,
      });
    });

    const nextReceipt: TableSettlementEntry = {
      id: ledgerReference.id,
      kind: 'discount',
      tableCode: normalizeTableCode(input.tableCode),
      method: 'coupon',
      amount: discountTotal,
      status: 'applied',
      couponCode: quote.code,
      title: quote.title,
      operatorName: operatorNameFor(user),
      createdAt: timestamp,
    };
    receipt = nextReceipt;
    transaction.set(ledgerReference, {
      id: ledgerReference.id,
      entryType: 'discount',
      status: 'applied',
      storeId: input.storeId,
      tableCode: nextReceipt.tableCode,
      method: 'coupon',
      amount: discountTotal,
      originalAmount: selectedSubtotal,
      discountAmount: discountTotal,
      couponCode: quote.code,
      couponTitle: quote.title,
      promotionId: quote.promotionId,
      quantity: input.selections.reduce((sum, selection) => sum + selection.quantity, 0),
      items: Array.from(allocations.entries()).map(([key, amount]) => ({ key, amount })),
      operatorId: user.uid,
      operatorName: nextReceipt.operatorName,
      createdAt: timestamp,
    });
  });

  if (!receipt) throw new Error('Não foi possível aplicar o cupom.');
  return receipt;
};

export const subscribeTableSettlementHistory = (
  storeId: string,
  tableCode: string,
  onChange: (entries: TableSettlementEntry[]) => void,
  onError?: (error: Error) => void
): Unsubscribe => {
  const expectedTableKey = tableKey(tableCode);
  return onSnapshot(
    collection(db, `artifacts/${storeId}/public/data/tablePayments`),
    snapshot => {
      const entries = snapshot.docs.flatMap(documentSnapshot => {
        const value = documentSnapshot.data() as Record<string, unknown>;
        if (tableKey(typeof value.tableCode === 'string' ? value.tableCode : '') !== expectedTableKey) return [];
        const rawMethod = value.method;
        const paymentMethod: TablePaymentMethod | null =
          rawMethod === 'cash' || rawMethod === 'pix' || rawMethod === 'card' || rawMethod === 'other'
            ? rawMethod
            : null;
        const isDiscount = value.entryType === 'discount' || rawMethod === 'coupon';
        if (!isDiscount && !paymentMethod) return [];
        const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) ? value.amount : 0;
        const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';
        return [{
          id: documentSnapshot.id,
          kind: isDiscount ? 'discount' as const : 'payment' as const,
          tableCode: normalizeTableCode(tableCode),
          method: isDiscount ? 'coupon' as const : paymentMethod!,
          amount: roundMoney(Math.max(0, amount)),
          status: isDiscount ? 'applied' as const : 'confirmed' as const,
          couponCode: typeof value.couponCode === 'string' ? value.couponCode.trim() : '',
          title: typeof value.couponTitle === 'string' ? value.couponTitle.trim() : '',
          operatorName: typeof value.operatorName === 'string' ? value.operatorName.trim() : '',
          createdAt,
        } satisfies TableSettlementEntry];
      }).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
      onChange(entries);
    },
    error => onError?.(error instanceof Error ? error : new Error('Não foi possível carregar o histórico.'))
  );
};

export const applyTableTransferSelections = (
  orders: CustomerOrder[],
  sourceTableCode: string,
  targetTableCode: string,
  selections: TableItemSelection[],
  operator: { id: string; name: string },
  now: number = Date.now()
): AppliedTableTransfer => {
  const sourceKey = tableKey(sourceTableCode);
  const targetCode = normalizeTableCode(targetTableCode);
  const targetKey = tableKey(targetCode);

  if (!targetCode) throw new Error('Informe a mesa de destino.');
  if (sourceKey === targetKey) throw new Error('Escolha uma mesa de destino diferente.');

  const grouped = groupSelections(selections);
  const timestamp = new Date(now).toISOString();
  let amount = 0;
  let quantity = 0;
  const targetOrders: CustomerOrder[] = [];

  const updatedSourceOrders = orders.map((order, orderIndex) => {
    const orderSelections = grouped.get(order.id);
    if (!orderSelections) return order;
    if (
      order.fulfillmentType !== 'dine_in' ||
      tableKey(order.tableCode) !== sourceKey ||
      isTerminalCustomerOrderStatus(order.status)
    ) {
      throw new Error('O pedido selecionado não está ativo na mesa de origem.');
    }

    const transferredItems: CustomerOrderItem[] = [];
    const nextItems = order.items.map((item, itemIndex) => {
      const selectedQuantity = orderSelections.get(item.lineId) ?? 0;
      if (selectedQuantity === 0) return item;

      const availableQuantity = getCustomerOrderItemOpenQuantity(item);
      if (selectedQuantity > availableQuantity) {
        throw new Error(`Quantidade indisponível para “${item.name}”.`);
      }

      amount += selectedQuantity * item.price;
      quantity += selectedQuantity;
      transferredItems.push({
        ...item,
        lineId: `transfer-${order.id}-${now}-${itemIndex + 1}`,
        quantity: selectedQuantity,
        paidQuantity: 0,
        transferredQuantity: 0,
        voidedQuantity: 0,
        settledAmount: 0,
        discountAmount: 0,
      });

      return {
        ...item,
        transferredQuantity: item.transferredQuantity + selectedQuantity,
      };
    });

    orderSelections.forEach((_, lineId) => {
      if (!order.items.some(item => item.lineId === lineId)) {
        throw new Error('Um dos itens selecionados não foi encontrado.');
      }
    });

    if (transferredItems.length > 0) {
      const targetOrderId = `transfer-order-${order.id}-${now}-${orderIndex + 1}`;
      const targetTotal = transferredItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );
      targetOrders.push({
        ...order,
        id: targetOrderId,
        tableCode: targetCode,
        items: transferredItems.map((item, index) => ({
          ...item,
          lineId: `${targetOrderId}-line-${index + 1}`,
        })),
        subtotal: targetTotal,
        total: targetTotal,
        paymentStatus: 'unpaid',
        source: 'transfer',
        operatorId: operator.id,
        operatorName: operator.name,
        customerNote: `Itens transferidos da mesa ${normalizeTableCode(sourceTableCode)}.`,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    const allItemsClosed = nextItems.every(
      item => getCustomerOrderItemOpenQuantity(item) === 0
    );

    return {
      ...order,
      items: nextItems,
      paymentStatus: resolveCustomerOrderPaymentStatus(nextItems),
      status: allItemsClosed ? 'completed' : order.status,
      updatedAt: timestamp,
    };
  });

  grouped.forEach((_, orderId) => {
    if (!orders.some(order => order.id === orderId)) {
      throw new Error('Um dos pedidos selecionados não foi encontrado.');
    }
  });

  return { updatedSourceOrders, targetOrders, amount, quantity };
};

export const transferTableItems = async (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  input: TransferTableItemsInput
): Promise<AppliedTableTransfer> => {
  if (user.uid !== input.storeId) {
    throw new Error('Somente a loja autenticada pode transferir itens.');
  }

  const grouped = groupSelections(input.selections);
  const orderReferences = Array.from(grouped.keys()).map(orderId =>
    doc(db, getCustomerOrderDocumentPath(input.storeId, orderId))
  );
  let result: AppliedTableTransfer | null = null;

  await runTransaction(db, async transaction => {
    const snapshots = await Promise.all(
      orderReferences.map(reference => transaction.get(reference))
    );
    const orders = snapshots.map(snapshot => parseCustomerOrder(snapshot.data()));

    if (orders.some(order => order === null)) {
      throw new Error('Não foi possível carregar todos os itens selecionados.');
    }

    const applied = applyTableTransferSelections(
      orders as CustomerOrder[],
      input.sourceTableCode,
      input.targetTableCode,
      input.selections,
      { id: user.uid, name: operatorNameFor(user) }
    );
    result = applied;

    applied.updatedSourceOrders.forEach(order => {
      transaction.update(
        doc(db, getCustomerOrderDocumentPath(input.storeId, order.id)),
        {
          items: order.items,
          paymentStatus: order.paymentStatus,
          status: order.status,
          updatedAt: order.updatedAt,
        }
      );
    });

    applied.targetOrders.forEach(order => {
      transaction.set(
        doc(db, getCustomerOrderDocumentPath(input.storeId, order.id)),
        order
      );
    });
  });

  if (!result) throw new Error('Não foi possível transferir os itens.');
  return result;
};

export const excludeTableItem = async (
  user: Pick<User, 'uid' | 'email' | 'displayName'>,
  input: ExcludeTableItemInput
): Promise<TableItemExclusionReceipt> => {
  const tableCode = normalizeTableCode(input.tableCode);
  const orderId = input.orderId.trim();
  const lineId = input.lineId.trim();

  if (user.uid !== input.storeId) {
    throw new Error('Somente a loja autenticada pode excluir itens da conta.');
  }
  if (!tableCode || !orderId || !lineId) {
    throw new Error('Item da conta não identificado.');
  }

  const orderReference = doc(db, getCustomerOrderDocumentPath(input.storeId, orderId));
  const exclusionReference = doc(
    collection(db, `artifacts/${input.storeId}/public/data/tableItemExclusions`)
  );
  let receipt: TableItemExclusionReceipt | null = null;

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(orderReference);
    const order = parseCustomerOrder(snapshot.data());
    if (!order) throw new Error('O pedido não foi encontrado.');
    if (
      order.fulfillmentType !== 'dine_in' ||
      tableKey(order.tableCode) !== tableKey(tableCode) ||
      isTerminalCustomerOrderStatus(order.status)
    ) {
      throw new Error('O item não está em uma conta ativa desta mesa.');
    }

    const sourceItem = order.items.find(item => item.lineId === lineId);
    if (!sourceItem) throw new Error('O item selecionado não foi encontrado.');
    const availableQuantity = getCustomerOrderItemOpenQuantity(sourceItem);
    if (availableQuantity <= 0) {
      throw new Error('Este item já não possui quantidade em aberto.');
    }

    const createdAt = new Date().toISOString();
    const nextItems = order.items.map(item =>
      item.lineId === lineId
        ? { ...item, voidedQuantity: (item.voidedQuantity ?? 0) + availableQuantity }
        : item
    );
    const allItemsClosed = nextItems.every(
      item => getCustomerOrderItemOpenQuantity(item) === 0
    );
    const nextSubtotal = nextItems.reduce(
      (sum, item) =>
        sum + item.price * Math.max(0, item.quantity - (item.voidedQuantity ?? 0)),
      0
    );

    transaction.update(orderReference, {
      items: nextItems,
      subtotal: nextSubtotal,
      total: nextSubtotal,
      status: allItemsClosed ? 'cancelled' : order.status,
      updatedAt: createdAt,
    });

    const nextReceipt: TableItemExclusionReceipt = {
      exclusionId: exclusionReference.id,
      orderId: order.id,
      lineId: sourceItem.lineId,
      tableCode,
      productId: sourceItem.productId,
      itemName: sourceItem.name,
      quantity: availableQuantity,
      amount: sourceItem.price * availableQuantity,
      createdAt,
    };
    receipt = nextReceipt;
    transaction.set(exclusionReference, {
      ...nextReceipt,
      storeId: input.storeId,
      unitPrice: sourceItem.price,
      previousOrderStatus: order.status,
      operatorId: user.uid,
      operatorName: operatorNameFor(user),
      reason: '',
      authorizationMode: 'temporary_simple_exclusion',
    });
  });

  if (!receipt) throw new Error('Não foi possível excluir o item da conta.');
  return receipt;
};

export const getTablePaymentMethodLabel = (
  method: TablePaymentMethod
): string => {
  const labels: Record<TablePaymentMethod, string> = {
    cash: 'Dinheiro',
    pix: 'Pix',
    card: 'Cartão',
    other: 'Outro',
  };
  return labels[method];
};