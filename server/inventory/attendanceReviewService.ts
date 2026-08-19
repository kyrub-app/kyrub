import { adminAuth, adminDb } from '../firebaseAdmin';

export type AttendanceReviewItemInput = {
  lineId: string;
  quantity: number;
  note: string;
};

export type AttendanceReviewInput = {
  action: 'approve' | 'reject';
  items: AttendanceReviewItemInput[];
  customerNote: string;
  reason?: string;
  alternative?: string;
};

export type AttendanceReviewResult = {
  orderId: string;
  action: 'approved' | 'rejected';
  status: 'pending' | 'rejected';
  total: number;
};

type ParsedLine = {
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
  source: Record<string, unknown>;
};

type PendingAttendanceOrder = {
  id: string;
  customerNote: string;
  items: ParsedLine[];
};

const clean = (value: unknown, maximum = 1000): string =>
  typeof value === 'string'
    ? value.trim().slice(0, maximum)
    : '';

const finiteInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;

const finiteMoney = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;

const orderPath = (tenantId: string, orderId: string): string =>
  `artifacts/${tenantId}/public/data/customerOrders/${orderId}`;

const parsePendingAttendanceOrder = (
  orderId: string,
  value: unknown
): PendingAttendanceOrder | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    clean(record.id) !== orderId ||
    clean(record.source) !== 'customer' ||
    clean(record.fulfillmentType) !== 'dine_in' ||
    !clean(record.tableCode) ||
    clean(record.status) !== 'pending' ||
    clean(record.operatorId)
  ) {
    return null;
  }
  if (!Array.isArray(record.items) || record.items.length === 0) return null;

  const items = record.items.flatMap(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return [];
    const line = candidate as Record<string, unknown>;
    const lineId = clean(line.lineId, 180);
    const productId = clean(line.productId, 180);
    const name = clean(line.name, 240);
    const price = finiteMoney(line.price);
    const quantity = finiteInteger(line.quantity);
    const paidQuantity = finiteInteger(line.paidQuantity) ?? 0;
    const transferredQuantity = finiteInteger(line.transferredQuantity) ?? 0;
    if (!lineId || !productId || !name || price === null || quantity === null || quantity <= 0) {
      return [];
    }
    return [{
      lineId,
      productId,
      name,
      price,
      quantity,
      paidQuantity,
      transferredQuantity,
      note: clean(line.note, 500),
      image: clean(line.image, 1000),
      isService: line.isService === true,
      source: line,
    } satisfies ParsedLine];
  });

  if (items.length !== record.items.length) return null;
  return {
    id: orderId,
    customerNote: clean(record.customerNote, 2000),
    items,
  };
};

const operatorLabel = async (tenantId: string): Promise<string> => {
  try {
    const user = await adminAuth.getUser(tenantId);
    return user.displayName?.trim() || user.email?.trim() || 'Staff Kyrub';
  } catch {
    return 'Staff Kyrub';
  }
};

const normalizedReview = (value: unknown): AttendanceReviewInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Revise os dados da comanda.');
  }
  const record = value as Record<string, unknown>;
  const action = record.action === 'reject' ? 'reject' : record.action === 'approve' ? 'approve' : null;
  if (!action) throw new Error('A decisão da comanda é inválida.');
  const rawItems = Array.isArray(record.items) ? record.items : [];
  if (rawItems.length > 80) throw new Error('A comanda possui itens demais para esta revisão.');

  const seen = new Set<string>();
  const items = rawItems.map(candidate => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new Error('Revise os itens da comanda.');
    }
    const line = candidate as Record<string, unknown>;
    const lineId = clean(line.lineId, 180);
    const quantity = finiteInteger(line.quantity);
    if (!lineId || seen.has(lineId) || quantity === null) {
      throw new Error('Revise as quantidades da comanda.');
    }
    seen.add(lineId);
    return {
      lineId,
      quantity,
      note: clean(line.note, 500),
    };
  });

  const reason = clean(record.reason, 500);
  if (action === 'reject' && !reason) {
    throw new Error('Explique o motivo da recusa.');
  }
  return {
    action,
    items,
    customerNote: clean(record.customerNote, 2000),
    ...(reason ? { reason } : {}),
    ...(clean(record.alternative, 500)
      ? { alternative: clean(record.alternative, 500) }
      : {}),
  };
};

const decisionText = (input: AttendanceReviewInput): string =>
  [
    input.reason ? `Motivo da recusa: ${input.reason}` : '',
    input.alternative ? `Alternativa sugerida: ${input.alternative}` : '',
  ].filter(Boolean).join(' · ');

const mergedNote = (current: string, extra: string): string =>
  [current.trim(), extra.trim()].filter(Boolean).join('\n');

export const reviewAttendanceOrderAuthoritatively = async (
  tenantId: string,
  orderId: string,
  rawInput: unknown
): Promise<AttendanceReviewResult> => {
  const normalizedTenantId = clean(tenantId, 180);
  const normalizedOrderId = clean(orderId, 180);
  if (!normalizedTenantId || !normalizedOrderId || normalizedOrderId.includes('/')) {
    throw new Error('Pedido não identificado.');
  }
  const input = normalizedReview(rawInput);
  const operatorName = await operatorLabel(normalizedTenantId);

  return adminDb.runTransaction(async transaction => {
    const orderReference = adminDb.doc(orderPath(normalizedTenantId, normalizedOrderId));
    const tenantReference = adminDb.doc(`tenants/${normalizedTenantId}`);
    const [orderSnapshot, tenantSnapshot] = await Promise.all([
      transaction.get(orderReference),
      transaction.get(tenantReference),
    ]);
    const order = parsePendingAttendanceOrder(normalizedOrderId, orderSnapshot.data());
    if (!order) {
      throw new Error('Este pedido de autoatendimento não está mais aguardando revisão.');
    }

    const canonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId, 180);
    const canonicalReference = canonicalStoreId
      ? adminDb.doc(`stores/${canonicalStoreId}/orders/${normalizedOrderId}`)
      : null;
    const updatedAt = new Date().toISOString();

    if (input.action === 'reject') {
      const customerNote = mergedNote(order.customerNote, decisionText(input));
      const patch = {
        status: 'rejected',
        customerNote,
        operatorId: normalizedTenantId,
        operatorName,
        updatedAt,
      };
      transaction.set(orderReference, patch, { merge: true });
      if (canonicalReference) transaction.set(canonicalReference, patch, { merge: true });
      const total = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      return {
        orderId: normalizedOrderId,
        action: 'rejected',
        status: 'rejected',
        total,
      };
    }

    const requested = new Map(input.items.map(item => [item.lineId, item] as const));
    for (const lineId of requested.keys()) {
      if (!order.items.some(item => item.lineId === lineId)) {
        throw new Error('A comanda mudou desde que foi aberta. Recarregue antes de aprovar.');
      }
    }

    const items = order.items.flatMap(item => {
      const revision = requested.get(item.lineId);
      if (!revision) return [item.source];
      if (revision.quantity === 0) return [];
      return [{
        ...item.source,
        quantity: revision.quantity,
        paidQuantity: Math.min(item.paidQuantity, revision.quantity),
        transferredQuantity: Math.min(
          item.transferredQuantity,
          Math.max(0, revision.quantity - item.paidQuantity)
        ),
        note: revision.note,
      }];
    });
    if (items.length === 0) {
      throw new Error('Mantenha ao menos um item ou recuse o pedido.');
    }

    const total = items.reduce((sum, candidate) => {
      const item = candidate as Record<string, unknown>;
      return sum + (finiteMoney(item.price) ?? 0) * (finiteInteger(item.quantity) ?? 0);
    }, 0);
    const patch = {
      items,
      subtotal: total,
      total,
      customerNote: input.customerNote,
      status: 'pending',
      operatorId: normalizedTenantId,
      operatorName,
      updatedAt,
    };
    transaction.set(orderReference, patch, { merge: true });
    if (canonicalReference) transaction.set(canonicalReference, patch, { merge: true });

    return {
      orderId: normalizedOrderId,
      action: 'approved',
      status: 'pending',
      total,
    };
  });
};
