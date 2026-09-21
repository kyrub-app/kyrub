from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 match, found {count}')
    return text.replace(old, new, 1)

# ---------------------------------------------------------------------------
# Customer order monetary settlement fields.
# ---------------------------------------------------------------------------
path = Path('src/utils/customerOrders.ts')
text = path.read_text()
text = replace_once(
    text,
    "  voidedQuantity?: number;\n  note: string;",
    "  voidedQuantity?: number;\n  settledAmount?: number;\n  discountAmount?: number;\n  note: string;",
    'customer item monetary fields',
)
text = replace_once(
    text,
    "export const getCustomerOrderItemOpenQuantity = (\n  item: CustomerOrderItem\n): number =>\n  Math.max(\n    0,\n    item.quantity - item.paidQuantity - item.transferredQuantity - (item.voidedQuantity ?? 0)\n  );\n\nexport const getCustomerOrderOutstandingTotal = (\n  order: Pick<CustomerOrder, 'items'>\n): number =>\n  order.items.reduce(\n    (sum, item) => sum + getCustomerOrderItemOpenQuantity(item) * item.price,\n    0\n  );",
    "const roundOrderMoney = (value: number): number => Math.round(value * 100) / 100;\n\nexport const getCustomerOrderItemOutstandingAmount = (\n  item: CustomerOrderItem\n): number => {\n  const billableQuantity = Math.max(\n    0,\n    item.quantity - item.transferredQuantity - (item.voidedQuantity ?? 0)\n  );\n  const grossAmount = billableQuantity * item.price;\n  const legacyPaidAmount = item.paidQuantity * item.price;\n  const settledAmount = Math.max(0, item.settledAmount ?? 0);\n  const discountAmount = Math.max(0, item.discountAmount ?? 0);\n  return Math.max(\n    0,\n    roundOrderMoney(grossAmount - legacyPaidAmount - settledAmount - discountAmount)\n  );\n};\n\nexport const getCustomerOrderItemOpenQuantity = (\n  item: CustomerOrderItem\n): number => {\n  const availableQuantity = Math.max(\n    0,\n    item.quantity - item.paidQuantity - item.transferredQuantity - (item.voidedQuantity ?? 0)\n  );\n  const outstandingAmount = getCustomerOrderItemOutstandingAmount(item);\n  if (outstandingAmount <= 0.009 || availableQuantity === 0) return 0;\n  if (item.price <= 0) return availableQuantity;\n  return Math.min(availableQuantity, Math.ceil((outstandingAmount - 0.009) / item.price));\n};\n\nexport const getCustomerOrderOutstandingTotal = (\n  order: Pick<CustomerOrder, 'items'>\n): number =>\n  roundOrderMoney(\n    order.items.reduce(\n      (sum, item) => sum + getCustomerOrderItemOutstandingAmount(item),\n      0\n    )\n  );",
    'outstanding amount helpers',
)
text = replace_once(
    text,
    "export const resolveCustomerOrderPaymentStatus = (\n  items: CustomerOrderItem[]\n): CustomerOrderPaymentStatus => {\n  const billableQuantity = items.reduce(\n    (sum, item) =>\n      sum + Math.max(0, item.quantity - item.transferredQuantity - (item.voidedQuantity ?? 0)),\n    0\n  );\n  const paidQuantity = items.reduce((sum, item) => sum + item.paidQuantity, 0);\n\n  if (billableQuantity === 0 || paidQuantity >= billableQuantity) return 'paid';\n  if (paidQuantity > 0) return 'partial';\n  return 'unpaid';\n};",
    "export const resolveCustomerOrderPaymentStatus = (\n  items: CustomerOrderItem[]\n): CustomerOrderPaymentStatus => {\n  const billableAmount = items.reduce((sum, item) => {\n    const quantity = Math.max(\n      0,\n      item.quantity - item.transferredQuantity - (item.voidedQuantity ?? 0)\n    );\n    return sum + quantity * item.price - Math.max(0, item.discountAmount ?? 0);\n  }, 0);\n  const outstandingAmount = items.reduce(\n    (sum, item) => sum + getCustomerOrderItemOutstandingAmount(item),\n    0\n  );\n  const paidAmount = items.reduce(\n    (sum, item) => sum + item.paidQuantity * item.price + Math.max(0, item.settledAmount ?? 0),\n    0\n  );\n\n  if (billableAmount <= 0.009 || outstandingAmount <= 0.009) return 'paid';\n  if (paidAmount > 0.009) return 'partial';\n  return 'unpaid';\n};",
    'payment status monetary support',
)
text = text.replace("      voidedQuantity: 0,\n      note:", "      voidedQuantity: 0,\n      settledAmount: 0,\n      discountAmount: 0,\n      note:")
text = replace_once(
    text,
    "    const voidedQuantity = finiteNumber(record.voidedQuantity) ?? 0;\n\n    if (",
    "    const voidedQuantity = finiteNumber(record.voidedQuantity) ?? 0;\n    const settledAmount = finiteNumber(record.settledAmount) ?? 0;\n    const discountAmount = finiteNumber(record.discountAmount) ?? 0;\n\n    if (",
    'parse monetary fields',
)
text = replace_once(
    text,
    "      !Number.isInteger(voidedQuantity) ||\n      voidedQuantity < 0 ||\n      paidQuantity + transferredQuantity + voidedQuantity > quantity",
    "      !Number.isInteger(voidedQuantity) ||\n      voidedQuantity < 0 ||\n      settledAmount < 0 ||\n      discountAmount < 0 ||\n      paidQuantity + transferredQuantity + voidedQuantity > quantity ||\n      settledAmount + discountAmount >\n        Math.max(0, (quantity - paidQuantity - transferredQuantity - voidedQuantity) * price) + 0.009",
    'validate monetary fields',
)
text = replace_once(
    text,
    "      voidedQuantity,\n      note: cleanString(record.note),",
    "      voidedQuantity,\n      settledAmount,\n      discountAmount,\n      note: cleanString(record.note),",
    'parse monetary output',
)
text = replace_once(
    text,
    "    voidedQuantity: item.voidedQuantity ?? 0,\n    note: item.note,",
    "    voidedQuantity: item.voidedQuantity ?? 0,\n    settledAmount: Number((item.settledAmount ?? 0).toFixed(2)),\n    discountAmount: Number((item.discountAmount ?? 0).toFixed(2)),\n    note: item.note,",
    'comparable monetary fields',
)
path.write_text(text)

# ---------------------------------------------------------------------------
# Legacy table operations: monetary partial payments, coupon adjustment ledger,
# and a live table settlement history.
# ---------------------------------------------------------------------------
path = Path('src/utils/legacyTableOperations.ts')
text = path.read_text()
text = replace_once(
    text,
    "import { collection, doc, runTransaction } from 'firebase/firestore';",
    "import { collection, doc, onSnapshot, runTransaction, type Unsubscribe } from 'firebase/firestore';",
    'firestore history imports',
)
text = replace_once(
    text,
    "  getCustomerOrderItemOpenQuantity,\n  getCustomerOrderOutstandingTotal,",
    "  getCustomerOrderItemOpenQuantity,\n  getCustomerOrderItemOutstandingAmount,\n  getCustomerOrderOutstandingTotal,",
    'outstanding helper import',
)
text = replace_once(
    text,
    "  price: number;\n  availableQuantity: number;",
    "  price: number;\n  outstandingAmount: number;\n  availableQuantity: number;",
    'open line outstanding field',
)
text = replace_once(
    text,
    "export interface TableItemExclusionReceipt {\n  exclusionId: string;",
    "export interface TableSettlementEntry {\n  id: string;\n  kind: 'payment' | 'discount';\n  tableCode: string;\n  method: TablePaymentMethod | 'coupon';\n  amount: number;\n  status: 'confirmed' | 'applied';\n  couponCode: string;\n  title: string;\n  operatorName: string;\n  createdAt: string;\n}\n\nexport interface TableItemExclusionReceipt {\n  exclusionId: string;",
    'settlement history type',
)
text = replace_once(
    text,
    "interface TransferTableItemsInput {",
    "interface RegisterPartialTablePaymentInput {\n  storeId: string;\n  tableCode: string;\n  selections: TableItemSelection[];\n  method: Exclude<TablePaymentMethod, 'pix'>;\n  amount: number;\n}\n\ninterface ApplyTableCouponInput {\n  storeId: string;\n  tableCode: string;\n  selections: TableItemSelection[];\n  quote: StorePromotionQuote;\n}\n\ninterface TransferTableItemsInput {",
    'partial input types',
)
text = replace_once(
    text,
    "          price: item.price,\n          availableQuantity,",
    "          price: item.price,\n          outstandingAmount: getCustomerOrderItemOutstandingAmount(item),\n          availableQuantity,",
    'open line amount',
)
text = text.replace("      voidedQuantity: 0,\n      note: note.trim(),", "      voidedQuantity: 0,\n      settledAmount: 0,\n      discountAmount: 0,\n      note: note.trim(),")
text = text.replace("        voidedQuantity: 0,\n      });", "        voidedQuantity: 0,\n        settledAmount: 0,\n        discountAmount: 0,\n      });")

marker = "export const applyTableTransferSelections = ("
if text.count(marker) != 1:
    raise SystemExit('partial/coupon insertion marker not unique')
insert = r'''const selectedOutstandingCapacity = (
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
        const method = value.method;
        const isDiscount = value.entryType === 'discount' || method === 'coupon';
        if (!isDiscount && method !== 'cash' && method !== 'pix' && method !== 'card' && method !== 'other') return [];
        const amount = typeof value.amount === 'number' && Number.isFinite(value.amount) ? value.amount : 0;
        const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';
        return [{
          id: documentSnapshot.id,
          kind: isDiscount ? 'discount' as const : 'payment' as const,
          tableCode: normalizeTableCode(tableCode),
          method: isDiscount ? 'coupon' as const : method,
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

'''
text = text.replace(marker, insert + marker, 1)
path.write_text(text)

# Public table facade.
path = Path('src/utils/tableOperations.ts')
text = path.read_text()
text = replace_once(
    text,
    "  transferTableItems,\n  excludeTableItem,",
    "  transferTableItems,\n  registerTablePartialPayment,\n  applyTableCoupon,\n  subscribeTableSettlementHistory,\n  excludeTableItem,",
    'table facade functions',
)
text = replace_once(
    text,
    "  TableItemExclusionReceipt,\n} from './legacyTableOperations';",
    "  TableItemExclusionReceipt,\n  TableSettlementEntry,\n} from './legacyTableOperations';",
    'table facade types',
)
path.write_text(text)

# ---------------------------------------------------------------------------
# Pix intent may optionally request a partial amount, always capped server-side.
# ---------------------------------------------------------------------------
path = Path('shared/localPaymentIntent.ts')
text = path.read_text()
text = replace_once(text, "  couponCode?: string;\n}", "  couponCode?: string;\n  amount?: number;\n}", 'intent amount type')
text = replace_once(text, "const ALLOWED_FIELDS = new Set(['storeId', 'orderId', 'idempotencyKey', 'couponCode']);", "const ALLOWED_FIELDS = new Set(['storeId', 'orderId', 'idempotencyKey', 'couponCode', 'amount']);", 'intent allowed amount')
text = replace_once(
    text,
    "  const couponCode = clean(candidate.couponCode);\n",
    "  const couponCode = clean(candidate.couponCode);\n  const amount = typeof candidate.amount === 'number' && Number.isFinite(candidate.amount)\n    ? Math.round(candidate.amount * 100) / 100\n    : undefined;\n",
    'parse intent amount',
)
text = replace_once(
    text,
    "  if (couponCode.length > 48) {\n    throw new Error('LOCAL_PAYMENT_INTENT_COUPON_INVALID');\n  }",
    "  if (couponCode.length > 48) {\n    throw new Error('LOCAL_PAYMENT_INTENT_COUPON_INVALID');\n  }\n  if (amount !== undefined && amount <= 0) {\n    throw new Error('LOCAL_PAYMENT_INTENT_AMOUNT_INVALID');\n  }",
    'validate intent amount',
)
text = replace_once(
    text,
    "    ...(couponCode ? { couponCode } : {}),\n  };",
    "    ...(couponCode ? { couponCode } : {}),\n    ...(amount !== undefined ? { amount } : {}),\n  };",
    'intent amount output',
)
path.write_text(text)

path = Path('src/utils/localPixCheckout.ts')
text = path.read_text()
text = replace_once(text, "  couponCode?: string;\n}): Promise<LocalPaymentIntentResult>", "  couponCode?: string;\n  amount?: number;\n}): Promise<LocalPaymentIntentResult>", 'client pix amount type')
text = replace_once(
    text,
    "        ...(couponCode ? { couponCode } : {}),\n      }),",
    "        ...(couponCode ? { couponCode } : {}),\n        ...(input.amount !== undefined ? { amount: input.amount } : {}),\n      }),",
    'client pix amount body',
)
path.write_text(text)

path = Path('server/attendance/localPaymentIntentService.ts')
text = path.read_text()
text = replace_once(
    text,
    "    let amount = outstandingSubtotal; let commercialSnapshot:",
    "    let amount = request.amount ?? outstandingSubtotal;\n    if (amount > outstandingSubtotal + 0.009) throw new Error('LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING');\n    let commercialSnapshot:",
    'server requested amount',
)
text = replace_once(
    text,
    "      amount = Number((outstandingSubtotal - discountTotal).toFixed(2)); if (amount <= 0.009) throw new Error('LOCAL_COUPON_TOTAL_INVALID');",
    "      const discountedOutstanding = Number((outstandingSubtotal - discountTotal).toFixed(2)); if (discountedOutstanding <= 0.009) throw new Error('LOCAL_COUPON_TOTAL_INVALID');\n      if (request.amount !== undefined && request.amount > discountedOutstanding + 0.009) throw new Error('LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING');\n      amount = request.amount ?? discountedOutstanding;",
    'server coupon requested amount',
)
path.write_text(text)

# Server payable summary honors operational partial settlement, discount and voids.
path = Path('server/attendance/localOrderPayable.ts')
text = path.read_text()
text = replace_once(
    text,
    "    const transferred = quantity(line.transferredQuantity ?? 0);\n    if (",
    "    const transferred = quantity(line.transferredQuantity ?? 0);\n    const voided = quantity(line.voidedQuantity ?? 0);\n    const settledAmount = finite(line.settledAmount ?? 0);\n    const discountAmount = finite(line.discountAmount ?? 0);\n    if (",
    'payable extra fields',
)
text = replace_once(
    text,
    "      transferred === null ||\n      paid + transferred > ordered",
    "      transferred === null ||\n      voided === null ||\n      settledAmount === null || settledAmount < 0 ||\n      discountAmount === null || discountAmount < 0 ||\n      paid + transferred + voided > ordered",
    'payable validation',
)
text = replace_once(
    text,
    "    const billableQuantity = ordered - transferred;\n    const openQuantity = ordered - paid - transferred;\n    billableAmount += billableQuantity * price;\n    openAmount += openQuantity * price;\n    operationalPaidAmount += paid * price;\n    transferredAmount += transferred * price;\n    hasOperationalPaidQuantity ||= paid > 0;",
    "    const billableQuantity = ordered - transferred - voided;\n    const grossBillableAmount = billableQuantity * price;\n    const legacyPaidAmount = paid * price;\n    const netBillableAmount = Math.max(0, grossBillableAmount - discountAmount);\n    const lineOpenAmount = Math.max(0, netBillableAmount - legacyPaidAmount - settledAmount);\n    billableAmount += netBillableAmount;\n    openAmount += lineOpenAmount;\n    operationalPaidAmount += legacyPaidAmount + settledAmount;\n    transferredAmount += transferred * price;\n    hasOperationalPaidQuantity ||= paid > 0 || settledAmount > 0;",
    'payable monetary summary',
)
path.write_text(text)

# ---------------------------------------------------------------------------
# UI: history + value-to-pay + coupon as adjustment + explicit Pix request.
# ---------------------------------------------------------------------------
path = Path('src/components/customer/LegacyTableServiceWorkspace.tsx')
text = path.read_text()
text = replace_once(
    text,
    "  registerTablePayment,\n  transferTableItems,",
    "  registerTablePayment,\n  registerTablePartialPayment,\n  applyTableCoupon,\n  subscribeTableSettlementHistory,\n  transferTableItems,",
    'workspace settlement imports',
)
text = replace_once(
    text,
    "  type TablePaymentMethod,\n} from '../../utils/tableOperations';",
    "  type TablePaymentMethod,\n  type TableSettlementEntry,\n} from '../../utils/tableOperations';",
    'workspace history type',
)
text = replace_once(
    text,
    "  onAppliedCouponChange?: (couponCode: string) => void;\n}",
    "  onAppliedCouponChange?: (couponCode: string) => void;\n  onPaymentDraftChange?: (draft: { amount: number; orderIds: string[] }) => void;\n  onPixRequested?: () => void;\n}",
    'workspace callback props',
)
text = replace_once(
    text,
    "  onAppliedCouponChange,\n}: TableServiceWorkspaceProps) => {",
    "  onAppliedCouponChange,\n  onPaymentDraftChange,\n  onPixRequested,\n}: TableServiceWorkspaceProps) => {",
    'workspace callback destructure',
)
text = replace_once(
    text,
    "  const [couponQuote, setCouponQuote] = useState<StorePromotionQuote | null>(null);",
    "  const [couponQuote, setCouponQuote] = useState<StorePromotionQuote | null>(null);\n  const [paymentAmountInput, setPaymentAmountInput] = useState('');\n  const [settlementHistory, setSettlementHistory] = useState<TableSettlementEntry[]>([]);",
    'workspace settlement state',
)
text = replace_once(
    text,
    "    onAppliedCouponChange?.('');\n  }, [tableCode, onAppliedCouponChange]);",
    "    setPaymentAmountInput('');\n    setSettlementHistory([]);\n    onAppliedCouponChange?.('');\n    onPaymentDraftChange?.({ amount: 0, orderIds: [] });\n  }, [tableCode, onAppliedCouponChange, onPaymentDraftChange]);",
    'workspace reset state',
)
# Insert history subscription before storeProducts memo.
needle = "  const storeProducts = useMemo("
if text.count(needle) != 1:
    raise SystemExit('storeProducts marker not unique')
history_effect = """  useEffect(() =>\n    subscribeTableSettlementHistory(\n      storeId,\n      tableCode,\n      setSettlementHistory,\n      () => setSettlementHistory([])\n    ), [storeId, tableCode]);\n\n"""
text = text.replace(needle, history_effect + needle, 1)
text = replace_once(
    text,
    "  const selectedPaymentTotal = openLines.reduce(\n    (sum, line) => sum + (paymentSelections[line.key] ?? 0) * line.price,\n    0\n  );",
    "  const selectedPaymentTotal = openLines.reduce((sum, line) => {\n    const quantity = paymentSelections[line.key] ?? 0;\n    if (quantity <= 0) return sum;\n    const lineAmount = quantity >= line.availableQuantity\n      ? line.outstandingAmount\n      : Math.min(line.outstandingAmount, quantity * line.price);\n    return sum + lineAmount;\n  }, 0);",
    'selected monetary total',
)
text = replace_once(
    text,
    "  const payablePaymentTotal = couponQuote?.total ?? selectedPaymentTotal;",
    "  const payablePaymentTotal = selectedPaymentTotal;\n  const confirmedPaymentExists = settlementHistory.some(entry => entry.kind === 'payment' && entry.status === 'confirmed');\n  const paymentAmount = (() => {\n    const normalized = paymentAmountInput.trim().replace(/\\./g, '').replace(',', '.');\n    const parsed = Number(normalized);\n    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;\n  })();\n  const selectedPaymentOrderIds = Array.from(new Set(paymentSelectionArray.map(selection => selection.orderId)));",
    'payable and input amount',
)
# Update draft whenever amount/selection changes.
needle = "  const selectedTransferTotal = openLines.reduce("
draft_effect = """  useEffect(() => {\n    if (selectedPaymentTotal <= 0) {\n      setPaymentAmountInput('');\n      onPaymentDraftChange?.({ amount: 0, orderIds: [] });\n      return;\n    }\n    setPaymentAmountInput(selectedPaymentTotal.toFixed(2).replace('.', ','));\n  }, [selectedPaymentTotal]);\n\n  useEffect(() => {\n    onPaymentDraftChange?.({\n      amount: paymentAmount,\n      orderIds: selectedPaymentOrderIds,\n    });\n  }, [paymentAmount, selectedPaymentOrderIds.join('|'), onPaymentDraftChange]);\n\n"""
if text.count(needle) != 1:
    raise SystemExit('transfer total marker not unique')
text = text.replace(needle, draft_effect + needle, 1)
# Apply coupon persists adjustment.
old_apply = """      setCouponCode(quote.code);\n      setCouponQuote(quote);\n      onAppliedCouponChange?.(quote.code);\n      notify(\n        `Cupom ${quote.code} aplicado. Saldo a pagar: ${formatCurrency(quote.total)}.`,\n        'success'\n      );"""
new_apply = """      const user = auth.currentUser;\n      if (!user) throw new Error('Faça login novamente para aplicar o cupom.');\n      await applyTableCoupon(user, {\n        storeId,\n        tableCode,\n        selections: paymentSelectionArray,\n        quote,\n      });\n      setCouponCode('');\n      setCouponQuote(null);\n      onAppliedCouponChange?.('');\n      notify(\n        `Cupom ${quote.code} aplicado como desconto de ${formatCurrency(quote.discountTotal)}.`,\n        'success'\n      );"""
text = replace_once(text, old_apply, new_apply, 'persist coupon adjustment')
# Replace payment handler core call with partial and explicit Pix.
old_handler_fragment = """    setBusyAction('payment');\n    try {\n      let confirmedCoupon = couponQuote;\n      if (couponQuote) {\n        confirmedCoupon = await quoteLocalCoupon({\n          storeId,\n          couponCode: couponQuote.code,\n          items: selectedCouponItems,\n        });\n        assertCouponMatchesSelection(confirmedCoupon);\n        setCouponQuote(confirmedCoupon);\n        onAppliedCouponChange?.(confirmedCoupon.code);\n      }\n      const result = await registerTablePayment(user, {\n        storeId,\n        tableCode,\n        selections: paymentSelectionArray,\n        method: paymentMethod,\n        ...(confirmedCoupon ? { coupon: confirmedCoupon } : {}),\n      });"""
new_handler_fragment = """    if (paymentSelectionArray.length === 0) {\n      notify('Selecione ao menos um item para receber.', 'info');\n      return;\n    }\n    if (paymentAmount <= 0 || paymentAmount > payablePaymentTotal + 0.009) {\n      notify('Informe um valor válido, sem ultrapassar o saldo a pagar.', 'info');\n      return;\n    }\n    if (paymentMethod === 'pix') {\n      if (selectedPaymentOrderIds.length !== 1) {\n        notify('Para Pix parcial, selecione itens de um único pedido por vez.', 'info');\n        return;\n      }\n      onPixRequested?.();\n      return;\n    }\n\n    setBusyAction('payment');\n    try {\n      const result = await registerTablePartialPayment(user, {\n        storeId,\n        tableCode,\n        selections: paymentSelectionArray,\n        method: paymentMethod,\n        amount: paymentAmount,\n      });"""
text = replace_once(text, old_handler_fragment, new_handler_fragment, 'partial payment handler')
# Replace post payment coupon clearing block only first occurrence in handler area.
text = replace_once(
    text,
    "      setPaymentSelections({});\n      setCouponCode('');\n      setCouponQuote(null);\n      onAppliedCouponChange?.('');",
    "      setPaymentSelections({});\n      setPaymentAmountInput('');",
    'post partial payment cleanup',
)
# Replace summary/coupon/method block with enhanced layout via targeted insertions.
text = replace_once(
    text,
    "                    <div className=\"flex justify-between border-t border-slate-800 pt-2 font-black text-white\">\n                      <span>Saldo a pagar</span>\n                      <span>{formatCurrency(payablePaymentTotal)}</span>\n                    </div>\n                  </div>\n\n                  <div className=\"rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-3\">",
    "                    <div className=\"flex justify-between border-t border-slate-800 pt-2 font-black text-white\">\n                      <span>Saldo a pagar</span>\n                      <span>{formatCurrency(payablePaymentTotal)}</span>\n                    </div>\n                  </div>\n\n                  <div className=\"rounded-2xl border border-slate-800 bg-slate-900/70 p-3\">\n                    <div className=\"flex items-center justify-between\">\n                      <span className=\"text-[10px] font-black uppercase text-slate-200\">Histórico de pagamentos e ajustes</span>\n                      <span className=\"text-[8px] text-slate-600\">{settlementHistory.length}</span>\n                    </div>\n                    {settlementHistory.length === 0 ? (\n                      <p className=\"mt-2 text-[9px] text-slate-600\">Nenhum pagamento ou desconto registrado nesta mesa.</p>\n                    ) : (\n                      <div className=\"mt-2 space-y-1.5\">\n                        {settlementHistory.map(entry => (\n                          <div key={entry.id} className=\"flex items-center justify-between gap-3 rounded-xl bg-slate-950 px-2.5 py-2\">\n                            <div className=\"min-w-0\">\n                              <strong className={`block truncate text-[9px] ${entry.kind === 'discount' ? 'text-violet-200' : 'text-emerald-200'}`}>\n                                {entry.kind === 'discount'\n                                  ? `Cupom ${entry.couponCode || entry.title || 'aplicado'}`\n                                  : getTablePaymentMethodLabel(entry.method as TablePaymentMethod)}\n                              </strong>\n                              <span className=\"text-[8px] text-slate-600\">\n                                {entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}\n                                {entry.operatorName ? ` · ${entry.operatorName}` : ''}\n                              </span>\n                            </div>\n                            <span className={`font-mono text-[9px] font-black ${entry.kind === 'discount' ? 'text-violet-300' : 'text-emerald-300'}`}>\n                              {entry.kind === 'discount' ? '− ' : ''}{formatCurrency(entry.amount)}\n                            </span>\n                          </div>\n                        ))}\n                      </div>\n                    )}\n                  </div>\n\n                  <div className=\"rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3\">\n                    <label htmlFor=\"staff-table-payment-amount\" className=\"text-[10px] font-black text-emerald-100\">Valor a pagar agora</label>\n                    <div className=\"mt-2 flex gap-2\">\n                      <input\n                        id=\"staff-table-payment-amount\"\n                        type=\"text\"\n                        inputMode=\"decimal\"\n                        value={paymentAmountInput}\n                        onChange={event => setPaymentAmountInput(event.target.value.replace(/[^0-9,.]/g, ''))}\n                        placeholder=\"0,00\"\n                        className=\"min-h-10 min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 font-mono text-xs font-bold text-white outline-none focus:border-emerald-400\"\n                      />\n                      <button\n                        type=\"button\"\n                        onClick={() => setPaymentAmountInput(payablePaymentTotal.toFixed(2).replace('.', ','))}\n                        disabled={payablePaymentTotal <= 0}\n                        className=\"min-h-10 rounded-xl border border-emerald-500/25 px-3 text-[8px] font-black uppercase text-emerald-200 disabled:opacity-40\"\n                      >\n                        Usar saldo\n                      </button>\n                    </div>\n                  </div>\n\n                  <div className=\"rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-3\">",
    'history and amount layout',
)
# Coupon locked after first confirmed payment.
text = replace_once(
    text,
    "                        disabled={\n                          !couponCode.trim() ||\n                          paymentSelectionArray.length === 0 ||",
    "                        disabled={\n                          confirmedPaymentExists ||\n                          !couponCode.trim() ||\n                          paymentSelectionArray.length === 0 ||",
    'coupon button lock',
)
text = replace_once(
    text,
    "                        placeholder=\"Digite o cupom\"",
    "                        disabled={confirmedPaymentExists}\n                        placeholder={confirmedPaymentExists ? 'Cupom bloqueado após o primeiro pagamento' : 'Digite o cupom'}",
    'coupon input lock',
)
# Payment button disabled on invalid amount; Pix text opens QR.
text = replace_once(
    text,
    "                    disabled={paymentSelectionArray.length === 0 || busyAction === 'payment'}",
    "                    disabled={paymentSelectionArray.length === 0 || paymentAmount <= 0 || paymentAmount > payablePaymentTotal + 0.009 || busyAction === 'payment'}",
    'payment button amount validation',
)
text = replace_once(
    text,
    "                    {busyAction === 'payment' ? 'Registrando...' : 'Registrar pagamento'}",
    "                    {busyAction === 'payment'\n                      ? 'Registrando...'\n                      : paymentMethod === 'pix'\n                        ? 'Gerar cobrança Pix'\n                        : 'Registrar pagamento'}",
    'payment button pix label',
)
path.write_text(text)

# Wrapper stops intercepting the Pix method button; modal opens on final confirmation.
path = Path('src/components/customer/TableServiceWorkspace.tsx')
text = path.read_text()
text = replace_once(text, "import { useEffect, useMemo, useState } from 'react';\nimport type React from 'react';", "import { useEffect, useMemo, useState } from 'react';\nimport type React from 'react';", 'wrapper imports noop')
# Remove PIX_LABEL and intercept function by simple slices.
start = text.find("const PIX_LABEL =")
if start >= 0:
    end = text.find("\n\nexport const TableServiceWorkspace", start)
    text = text[:start] + text[end+2:]
text = replace_once(
    text,
    "  const [appliedCouponCode, setAppliedCouponCode] = useState('');",
    "  const [appliedCouponCode, setAppliedCouponCode] = useState('');\n  const [paymentDraft, setPaymentDraft] = useState<{ amount: number; orderIds: string[] }>({ amount: 0, orderIds: [] });",
    'wrapper payment draft state',
)
text = replace_once(
    text,
    "    setAppliedCouponCode('');\n  }, [props.storeId, props.tableCode]);",
    "    setAppliedCouponCode('');\n    setPaymentDraft({ amount: 0, orderIds: [] });\n  }, [props.storeId, props.tableCode]);",
    'wrapper draft reset',
)
# Remove interceptLegacyPix function if still present.
start = text.find("  const interceptLegacyPix =")
if start >= 0:
    end = text.find("\n\n  const canonicalCheckout", start)
    text = text[:start] + text[end:]
text = replace_once(
    text,
    "      couponCode={appliedCouponCode}\n    />",
    "      couponCode={appliedCouponCode}\n      requestedAmount={paymentDraft.amount}\n      targetOrderIds={paymentDraft.orderIds}\n    />",
    'wrapper canonical draft props',
)
old_return = """      <div onClickCapture={interceptLegacyPix}>\n        <LegacyTableServiceWorkspace\n          {...props}\n          onAppliedCouponChange={setAppliedCouponCode}\n        />\n      </div>"""
new_return = """      <LegacyTableServiceWorkspace\n        {...props}\n        onAppliedCouponChange={setAppliedCouponCode}\n        onPaymentDraftChange={setPaymentDraft}\n        onPixRequested={() => setPixCheckoutOpen(true)}\n      />"""
text = replace_once(text, old_return, new_return, 'wrapper explicit pix request')
path.write_text(text)

# Canonical Pix uses requested partial amount and selected order scope.
path = Path('src/components/store/ServiceLocationFinancialContextPanel.tsx')
text = path.read_text()
text = replace_once(
    text,
    "  couponCode: appliedCouponCode = '',\n}: {\n  storeId: string;\n  orders: CustomerOrder[];\n  couponCode?: string;\n}) {",
    "  couponCode: appliedCouponCode = '',\n  requestedAmount = 0,\n  targetOrderIds = [],\n}: {\n  storeId: string;\n  orders: CustomerOrder[];\n  couponCode?: string;\n  requestedAmount?: number;\n  targetOrderIds?: string[];\n}) {",
    'financial panel payment draft props',
)
text = replace_once(
    text,
    "          ...(couponCode ? { couponCode } : {}),\n        });",
    "          ...(couponCode ? { couponCode } : {}),\n          ...(requestedAmount > 0 ? { amount: requestedAmount } : {}),\n        });",
    'financial panel partial amount',
)
text = replace_once(
    text,
    "  }, [appliedCouponCode, patchPix, pixByOrder, refresh, storeId]);",
    "  }, [appliedCouponCode, patchPix, pixByOrder, refresh, requestedAmount, storeId]);",
    'financial panel callback deps',
)
# Add scope boolean in order render.
text = replace_once(
    text,
    "          const couponApplied = Boolean(visibleCheckout && pix.couponCode.trim());",
    "          const couponApplied = Boolean(visibleCheckout && pix.couponCode.trim());\n          const selectedForPix = targetOrderIds.length === 0 || (targetOrderIds.length === 1 && targetOrderIds[0] === order.id);",
    'financial selected order bool',
)
# Disable both provider buttons when not selected, via exact class snippets.
text = text.replace("disabled={pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'mercado-pago')}", "disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'mercado-pago')}")
text = text.replace("disabled={pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'store-pix')}", "disabled={!selectedForPix || pix.loading || Boolean(pix.boundProvider && pix.boundProvider !== 'store-pix')}")
# Insert scope hint.
text = text.replace("                  <div className=\"flex flex-wrap gap-2\">", "                  {targetOrderIds.length > 1 && <p className=\"mb-2 text-[8px] text-amber-200/75\">Para Pix parcial, selecione itens de um único pedido por vez.</p>}\n                  {selectedForPix && requestedAmount > 0 && <p className=\"mb-2 text-[8px] text-emerald-200/75\">Valor solicitado nesta cobrança: {money(requestedAmount)}.</p>}\n                  <div className=\"flex flex-wrap gap-2\">", 1)
path.write_text(text)

# Focused tests.
Path('tests/table-split-payment-history.test.ts').write_text(r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  getCustomerOrderItemOutstandingAmount,
  getCustomerOrderItemOpenQuantity,
  resolveCustomerOrderPaymentStatus,
  type CustomerOrderItem,
} from '../src/utils/customerOrders';

const item = (overrides: Partial<CustomerOrderItem> = {}): CustomerOrderItem => ({
  lineId: 'line-1', productId: 'product-1', name: 'X-BURGER', price: 29.5,
  quantity: 1, paidQuantity: 0, transferredQuantity: 0, voidedQuantity: 0,
  settledAmount: 0, discountAmount: 0, note: '', image: '', isService: false,
  ...overrides,
});

describe('split table payments and history', () => {
  test('discount and partial payment reduce monetary outstanding without erasing the line', () => {
    const line = item({ discountAmount: 4.5, settledAmount: 10 });
    assert.equal(getCustomerOrderItemOutstandingAmount(line), 15);
    assert.equal(getCustomerOrderItemOpenQuantity(line), 1);
    assert.equal(resolveCustomerOrderPaymentStatus([line]), 'partial');
  });

  test('fully settled monetary line closes even when paidQuantity remains legacy-zero', () => {
    const line = item({ discountAmount: 4.5, settledAmount: 25 });
    assert.equal(getCustomerOrderItemOutstandingAmount(line), 0);
    assert.equal(getCustomerOrderItemOpenQuantity(line), 0);
    assert.equal(resolveCustomerOrderPaymentStatus([line]), 'paid');
  });

  test('table account exposes history, amount field, coupon adjustment and explicit Pix confirmation', () => {
    const workspace = readFileSync('src/components/customer/LegacyTableServiceWorkspace.tsx', 'utf8');
    assert.match(workspace, /Histórico de pagamentos e ajustes/);
    assert.match(workspace, /Valor a pagar agora/);
    assert.match(workspace, /Usar saldo/);
    assert.match(workspace, /registerTablePartialPayment/);
    assert.match(workspace, /applyTableCoupon/);
    assert.match(workspace, /onPixRequested/);
    assert.match(workspace, /Cupom bloqueado após o primeiro pagamento/);
  });

  test('local Pix intent accepts a server-capped requested amount', () => {
    const shared = readFileSync('shared/localPaymentIntent.ts', 'utf8');
    const service = readFileSync('server/attendance/localPaymentIntentService.ts', 'utf8');
    assert.match(shared, /amount\?: number/);
    assert.match(service, /LOCAL_PAYMENT_INTENT_AMOUNT_EXCEEDS_OUTSTANDING/);
    assert.match(service, /request\.amount \?\? outstandingSubtotal/);
  });
});
''')
