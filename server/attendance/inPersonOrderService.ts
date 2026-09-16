import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';
import { buildServiceLocationSnapshot } from '../../shared/serviceLocation.js';
import {
  parseInPersonOrderCreateInput,
  type InPersonCatalogProduct,
  type InPersonOrderCreateInput,
} from '../../shared/inPersonOrder.js';
import type {
  CustomerOrder,
  CustomerOrderItem,
} from '../../src/utils/customerOrders.js';
import { getServiceLocation } from './serviceLocationService.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const LEGACY_ORDER_ROOT = (storeId: string): string =>
  `artifacts/${storeId}/public/data/customerOrders`;

export interface InPersonOrderStoreContext {
  legacyStoreId: string;
  canonicalStoreId: string;
}

export const resolveInPersonOrderStoreContext = async (
  legacyStoreIdInput: string
): Promise<InPersonOrderStoreContext> => {
  const legacyStoreId = clean(legacyStoreIdInput);
  if (!legacyStoreId) throw new Error('IN_PERSON_ORDER_STORE_REQUIRED');

  const [privateStoreSnapshot, tenantSnapshot] = await Promise.all([
    adminDb.doc(`users/${legacyStoreId}/stores/${legacyStoreId}`).get(),
    adminDb.doc(`tenants/${legacyStoreId}`).get(),
  ]);
  if (!privateStoreSnapshot.exists) {
    throw new Error('IN_PERSON_ORDER_STORE_NOT_FOUND');
  }
  const privateStore = privateStoreSnapshot.data() as Record<string, unknown>;
  if (
    clean(privateStore.id) !== legacyStoreId ||
    clean(privateStore.ownerId) !== legacyStoreId
  ) {
    throw new Error('IN_PERSON_ORDER_STORE_SCOPE_INVALID');
  }

  const tenantCanonicalStoreId = clean(tenantSnapshot.data()?.canonicalStoreId);
  const privateCanonicalStoreId = clean(privateStore.canonicalStoreId);
  if (
    tenantCanonicalStoreId &&
    privateCanonicalStoreId &&
    tenantCanonicalStoreId !== privateCanonicalStoreId
  ) {
    throw new Error('IN_PERSON_ORDER_CANONICAL_STORE_CONFLICT');
  }

  let canonicalStoreId = tenantCanonicalStoreId || privateCanonicalStoreId;
  if (!canonicalStoreId) {
    const querySnapshot = await adminDb
      .collection('stores')
      .where('ownerId', '==', legacyStoreId)
      .where('legacyTenantId', '==', legacyStoreId)
      .limit(2)
      .get();
    if (querySnapshot.size > 1) {
      throw new Error('IN_PERSON_ORDER_CANONICAL_STORE_AMBIGUOUS');
    }
    canonicalStoreId = querySnapshot.docs[0]?.id ?? '';
  }
  if (!canonicalStoreId) {
    throw new Error('IN_PERSON_ORDER_CANONICAL_STORE_REQUIRED');
  }

  const canonicalSnapshot = await adminDb.doc(`stores/${canonicalStoreId}`).get();
  if (!canonicalSnapshot.exists) {
    throw new Error('IN_PERSON_ORDER_CANONICAL_STORE_NOT_FOUND');
  }
  const canonicalStore = canonicalSnapshot.data() as Record<string, unknown>;
  if (
    clean(canonicalStore.ownerId) !== legacyStoreId ||
    clean(canonicalStore.legacyTenantId) !== legacyStoreId
  ) {
    throw new Error('IN_PERSON_ORDER_CANONICAL_STORE_SCOPE_INVALID');
  }

  // Status/inventory authorities still resolve the canonical store through the
  // legacy tenant. Refuse to create a split-brain order if that binding is absent.
  if (!tenantCanonicalStoreId || tenantCanonicalStoreId !== canonicalStoreId) {
    throw new Error('IN_PERSON_ORDER_CANONICAL_CUTOVER_REQUIRED');
  }

  return { legacyStoreId, canonicalStoreId };
};

const parseCatalogProduct = (
  documentId: string,
  value: Record<string, unknown>,
  canonicalStoreId: string
): InPersonCatalogProduct | null => {
  const id = clean(documentId);
  const storedId = clean(value.id);
  const storeId = clean(value.storeId);
  const name = clean(value.name);
  const price = finite(value.price);
  const stockValue = finite(value.stock);
  const publicationStatus = clean(value.publicationStatus);
  if (
    !id ||
    storedId !== id ||
    storeId !== canonicalStoreId ||
    !name ||
    price === null ||
    price < 0 ||
    stockValue === null ||
    !Number.isSafeInteger(stockValue) ||
    stockValue < 0 ||
    publicationStatus !== 'published'
  ) {
    return null;
  }
  return {
    id,
    name,
    price,
    image: clean(value.image),
    stock: stockValue,
    isService: value.isService === true,
    publicationStatus: 'published',
  };
};

export const listInPersonOrderCatalog = async (input: {
  legacyStoreId: string;
}): Promise<{ canonicalStoreId: string; products: InPersonCatalogProduct[] }> => {
  const context = await resolveInPersonOrderStoreContext(input.legacyStoreId);
  const snapshot = await adminDb
    .collection(`stores/${context.canonicalStoreId}/products`)
    .limit(500)
    .get();
  const products = snapshot.docs
    .flatMap(document => {
      const product = parseCatalogProduct(
        document.id,
        document.data() as Record<string, unknown>,
        context.canonicalStoreId
      );
      return product ? [product] : [];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  return { canonicalStoreId: context.canonicalStoreId, products };
};

const resolveOrderItems = async (input: {
  canonicalStoreId: string;
  orderId: string;
  requested: InPersonOrderCreateInput['items'];
}): Promise<CustomerOrderItem[]> => {
  const references = input.requested.map(line =>
    adminDb.doc(`stores/${input.canonicalStoreId}/products/${line.productId}`)
  );
  const snapshots = references.length ? await adminDb.getAll(...references) : [];
  return input.requested.map((line, index) => {
    const snapshot = snapshots[index];
    if (!snapshot?.exists) throw new Error('IN_PERSON_ORDER_PRODUCT_NOT_FOUND');
    const product = parseCatalogProduct(
      snapshot.id,
      snapshot.data() as Record<string, unknown>,
      input.canonicalStoreId
    );
    if (!product) throw new Error('IN_PERSON_ORDER_PRODUCT_NOT_SELLABLE');
    if (!product.isService && line.quantity > product.stock) {
      throw new Error('IN_PERSON_ORDER_PRODUCT_STOCK_INSUFFICIENT');
    }
    return {
      lineId: `${input.orderId}-line-${index + 1}`,
      productId: product.id,
      name: product.name,
      price: product.price,
      quantity: line.quantity,
      paidQuantity: 0,
      transferredQuantity: 0,
      note: line.note,
      image: product.image,
      isService: product.isService,
    } satisfies CustomerOrderItem;
  });
};

export const createInPersonOrder = async (input: {
  authenticatedUserId: string;
  value: unknown;
  now?: Date;
}): Promise<CustomerOrder> => {
  const request = parseInPersonOrderCreateInput(input.value);
  const actorUserId = clean(input.authenticatedUserId);
  if (!actorUserId || actorUserId !== request.storeId) {
    throw new Error('IN_PERSON_ORDER_FORBIDDEN');
  }
  const context = await resolveInPersonOrderStoreContext(request.storeId);
  const location = await getServiceLocation({
    storeId: context.legacyStoreId,
    locationId: request.serviceLocationId,
    requireActive: true,
  });
  const serviceLocation = buildServiceLocationSnapshot(location);

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error('IN_PERSON_ORDER_TIME_INVALID');
  const timestamp = now.toISOString();
  const idSeed = adminDb.collection(LEGACY_ORDER_ROOT(context.legacyStoreId)).doc().id;
  const orderId = `staff-order-${idSeed}`;
  const items = await resolveOrderItems({
    canonicalStoreId: context.canonicalStoreId,
    orderId,
    requested: request.items,
  });
  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  const order: CustomerOrder = {
    id: orderId,
    storeId: context.legacyStoreId,
    // Namespaced operational handle only. It is deliberately not a Kyrub user ID.
    buyerId: `local-order:${orderId}`,
    buyerName: request.customerLabel || serviceLocation.label,
    buyerEmail: '',
    fulfillmentType: 'dine_in',
    deliveryAddress: '',
    tableCode: serviceLocation.kind === 'table' ? serviceLocation.label : '',
    serviceLocation,
    customerNote: request.customerNote,
    items,
    subtotal,
    total: subtotal,
    status: 'pending',
    paymentStatus: 'unpaid',
    source: 'staff',
    sourceChannel: 'kyrub',
    operatorId: actorUserId,
    operatorName: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  const legacyReference = adminDb.doc(
    `${LEGACY_ORDER_ROOT(context.legacyStoreId)}/${orderId}`
  );
  const canonicalReference = adminDb.doc(
    `stores/${context.canonicalStoreId}/orders/${orderId}`
  );
  const canonicalOrder = {
    ...order,
    storeId: context.canonicalStoreId,
    buyerIdentityStatus: 'unverified_local',
    createdByUserId: actorUserId,
    createdByRole: 'owner',
    legacyStoreId: context.legacyStoreId,
    legacyCreatedAt: timestamp,
    legacyUpdatedAt: timestamp,
    migratedFromPath: legacyReference.path,
    migration: {
      mode: 'canonical_first',
      originatedByUserId: actorUserId,
      originatedByRole: 'owner',
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const batch = adminDb.batch();
  batch.create(legacyReference, {
    ...order,
    buyerIdentityStatus: 'unverified_local',
  });
  batch.create(canonicalReference, canonicalOrder);
  await batch.commit();
  return order;
};
