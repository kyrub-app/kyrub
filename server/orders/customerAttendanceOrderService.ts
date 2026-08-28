import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finiteMoney = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : null;

const positiveInteger = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : null;

const safeId = (value: unknown): string => {
  const id = clean(value);
  return /^[a-zA-Z0-9_-]{1,240}$/.test(id) ? id : '';
};

type AttendanceOrderItem = {
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
};

type AttendanceOrder = {
  id: string;
  storeId: string;
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  fulfillmentType: 'dine_in';
  deliveryAddress: '';
  tableCode: string;
  customerNote: string;
  items: AttendanceOrderItem[];
  subtotal: number;
  total: number;
  status: 'pending';
  paymentStatus: 'unpaid';
  source: 'customer';
  operatorId: string;
  operatorName: string;
  createdAt: string;
  updatedAt: string;
};

const parseAttendanceOrder = (
  value: unknown,
  authenticatedBuyerId: string
): AttendanceOrder => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ATTENDANCE_ORDER_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  const id = safeId(candidate.id);
  const storeId = safeId(candidate.storeId);
  const buyerId = safeId(candidate.buyerId);
  const buyerName = clean(candidate.buyerName);
  const buyerEmail = clean(candidate.buyerEmail);
  const tableCode = clean(candidate.tableCode);
  const createdAt = clean(candidate.createdAt);
  const updatedAt = clean(candidate.updatedAt);

  if (
    !id || !storeId || !buyerId || buyerId !== authenticatedBuyerId ||
    !buyerName || !buyerEmail || !tableCode ||
    candidate.fulfillmentType !== 'dine_in' ||
    candidate.deliveryAddress !== '' ||
    candidate.status !== 'pending' ||
    candidate.paymentStatus !== 'unpaid' ||
    candidate.source !== 'customer' ||
    !createdAt || !updatedAt ||
    Number.isNaN(Date.parse(createdAt)) || Number.isNaN(Date.parse(updatedAt)) ||
    !Array.isArray(candidate.items) || candidate.items.length === 0
  ) {
    throw new Error('ATTENDANCE_ORDER_INVALID');
  }

  const items = candidate.items.map((raw, index): AttendanceOrderItem => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('ATTENDANCE_ORDER_ITEM_INVALID');
    }
    const item = raw as Record<string, unknown>;
    const productId = safeId(item.productId);
    const name = clean(item.name);
    const price = finiteMoney(item.price);
    const quantity = positiveInteger(item.quantity);
    const paidQuantity = item.paidQuantity === 0 ? 0 : null;
    const transferredQuantity = item.transferredQuantity === 0 ? 0 : null;
    if (!productId || !name || price === null || quantity === null || paidQuantity === null || transferredQuantity === null) {
      throw new Error('ATTENDANCE_ORDER_ITEM_INVALID');
    }
    return {
      lineId: clean(item.lineId) || `${id}-line-${index + 1}`,
      productId,
      name,
      price,
      quantity,
      paidQuantity,
      transferredQuantity,
      note: clean(item.note),
      image: clean(item.image),
      isService: item.isService === true,
    };
  });

  const subtotal = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
  const suppliedSubtotal = finiteMoney(candidate.subtotal);
  const suppliedTotal = finiteMoney(candidate.total);
  if (suppliedSubtotal === null || suppliedTotal === null || suppliedSubtotal !== subtotal || suppliedTotal !== subtotal) {
    throw new Error('ATTENDANCE_ORDER_TOTAL_INVALID');
  }

  return {
    id,
    storeId,
    buyerId,
    buyerName,
    buyerEmail,
    fulfillmentType: 'dine_in',
    deliveryAddress: '',
    tableCode,
    customerNote: clean(candidate.customerNote),
    items,
    subtotal,
    total: subtotal,
    status: 'pending',
    paymentStatus: 'unpaid',
    source: 'customer',
    operatorId: clean(candidate.operatorId),
    operatorName: clean(candidate.operatorName),
    createdAt,
    updatedAt,
  };
};

const legacyOrderPath = (legacyStoreId: string, orderId: string): string =>
  `artifacts/${legacyStoreId}/public/data/customerOrders/${orderId}`;

const canonicalOrderPath = (canonicalStoreId: string, orderId: string): string =>
  `stores/${canonicalStoreId}/orders/${orderId}`;

export const createAuthorizedCustomerAttendanceOrder = async (
  authorization: string,
  body: unknown
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
  if (!token) {
    return { status: 401, body: { error: 'Entre novamente para enviar o pedido.', code: 'AUTH_REQUIRED' } };
  }

  const identity = await verifyFirebaseIdToken(token);
  const payload = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const order = parseAttendanceOrder(payload.order, identity.uid);
  const tenantRef = adminDb.doc(`tenants/${order.storeId}`);
  const tenantSnapshot = await tenantRef.get();
  if (!tenantSnapshot.exists) {
    return { status: 404, body: { error: 'Loja não encontrada.', code: 'STORE_NOT_FOUND' } };
  }

  const tenant = tenantSnapshot.data() as Record<string, unknown>;
  if (tenant.publicationStatus !== 'published') {
    return { status: 409, body: { error: 'A loja não está disponível para novos pedidos.', code: 'STORE_NOT_AVAILABLE' } };
  }
  const canonicalStoreId = safeId(tenant.canonicalStoreId) || order.storeId;
  const canonicalRef = adminDb.doc(canonicalOrderPath(canonicalStoreId, order.id));
  const legacyRef = adminDb.doc(legacyOrderPath(order.storeId, order.id));

  await adminDb.runTransaction(async transaction => {
    const [canonicalSnapshot, legacySnapshot] = await Promise.all([
      transaction.get(canonicalRef),
      transaction.get(legacyRef),
    ]);

    if (canonicalSnapshot.exists) {
      const existing = canonicalSnapshot.data() as Record<string, unknown>;
      if (existing.buyerId !== identity.uid || existing.legacyStoreId !== order.storeId) {
        throw new Error('ATTENDANCE_ORDER_ID_CONFLICT');
      }
    } else {
      transaction.create(canonicalRef, {
        ...order,
        storeId: canonicalStoreId,
        createdByUserId: identity.uid,
        createdByRole: 'customer',
        legacyStoreId: order.storeId,
        legacyCreatedAt: order.createdAt,
        legacyUpdatedAt: order.updatedAt,
        canonicalAuthority: true,
        schemaVersion: 2,
      });
    }

    // Temporary compatibility copy until every ERP/KDS reader is on canonical orders.
    if (!legacySnapshot.exists) {
      transaction.create(legacyRef, order);
    }
  });

  return {
    status: 201,
    body: {
      orderId: order.id,
      legacyStoreId: order.storeId,
      canonicalStoreId,
      canonicalAuthority: true,
    },
  };
};
