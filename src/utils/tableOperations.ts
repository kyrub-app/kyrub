import { collection, doc, runTransaction } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import type { Product } from '../types';
import { db } from './firebase';
import {
  getCustomerOrderDocumentPath,
  getCustomerOrderItemOpenQuantity,
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

interface RegisterTablePaymentInput {
  storeId: string;
  tableCode: string;
  selections: TableItemSelection[];
  method: TablePaymentMethod;
}

interface TransferTableItemsInput {
  storeId: string;
  sourceTableCode: string;
  targetTableCode: string;
  selections: TableItemSelection[];
}

const normalizeTableCode = (value: string): string => value.trim();
const tableKey = (value: string): string =>
  normalizeTableCode(value).toLocaleLowerCase('pt-BR');

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
    result = applied;

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
      amount: applied.amount,
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
