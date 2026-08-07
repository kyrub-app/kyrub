import type { User } from 'firebase/auth';
import {
  collection,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore';
import type {
  KyrubErpContextSnapshot,
  KyrubErpOrderSummary,
  KyrubErpProductSummary,
  KyrubErpStoreSummary,
} from '../../shared/kyrubErpContext';
import { db } from '../utils/firebase';
import {
  getCustomerOrdersCollectionPath,
  parseCustomerOrder,
} from '../utils/customerOrders';
import { parsePublicProducts } from '../utils/publicProducts';
import { getPrimaryUserStoreDocumentPath } from '../utils/storePaths';
import { normalizeCachedStore } from '../utils/storePersistence';

const LOW_STOCK_THRESHOLD = 5;
const MAX_PRODUCTS_IN_CONTEXT = 120;
const MAX_PENDING_ORDERS_IN_CONTEXT = 30;
const PENDING_ORDER_STATUSES = [
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
] as const;

const contextCache = new Map<
  string,
  { expiresAt: number; value: KyrubErpContextSnapshot }
>();
const CACHE_TTL_MS = 10_000;

const storeSummaryFrom = (
  user: Pick<User, 'uid' | 'email'>,
  data: Record<string, unknown>
): KyrubErpStoreSummary => {
  const store = normalizeCachedStore(
    data,
    user.uid,
    user.email ?? ''
  );

  return {
    id: store.id,
    name: store.name,
    description: store.description,
    plan: store.plan,
    status: store.status ?? 'closed',
    address: store.address ?? '',
    keywords: [...(store.keywords ?? [])].slice(0, 30),
    configured: Boolean(store.name.trim()),
  };
};

const productSummaryFrom = (
  product: ReturnType<typeof parsePublicProducts>[number]
): KyrubErpProductSummary => ({
  id: product.id,
  name: product.name,
  category: product.category,
  price: product.price,
  stock: product.isService ? 0 : product.stock,
  isService: product.isService === true,
  hasDescription: Boolean(product.description.trim()),
  hasImage: Boolean(product.image.trim()),
});

const orderSummaryFrom = (
  order: NonNullable<ReturnType<typeof parseCustomerOrder>>
): KyrubErpOrderSummary => ({
  id: order.id,
  status: order.status,
  paymentStatus: order.paymentStatus,
  fulfillmentType: order.fulfillmentType,
  total: order.total,
  itemCount: order.items.reduce((total, item) => total + item.quantity, 0),
  createdAt: order.createdAt,
});

export const invalidateKyrubErpContext = (uid?: string): void => {
  if (uid) {
    contextCache.delete(uid);
    return;
  }
  contextCache.clear();
};

export const readKyrubErpContext = async (
  user: Pick<User, 'uid' | 'email'>,
  options: { force?: boolean } = {}
): Promise<KyrubErpContextSnapshot> => {
  const cached = contextCache.get(user.uid);
  if (!options.force && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const warnings: string[] = [];
  let store: KyrubErpStoreSummary | null = null;
  let products: KyrubErpProductSummary[] = [];
  let productCount = 0;
  let productsTruncated = false;
  let pendingOrders: KyrubErpOrderSummary[] = [];
  let pendingOrderCount = 0;
  let ordersTruncated = false;
  let storeAvailable = false;
  let productsAvailable = false;
  let ordersAvailable = false;

  const storePromise = getDoc(
    doc(db, getPrimaryUserStoreDocumentPath(user.uid))
  );
  const tenantPromise = getDoc(doc(db, 'tenants', user.uid));
  const pendingOrdersQuery = query(
    collection(db, getCustomerOrdersCollectionPath(user.uid)),
    where('status', 'in', [...PENDING_ORDER_STATUSES]),
    limit(MAX_PENDING_ORDERS_IN_CONTEXT)
  );
  const pendingOrderCountQuery = query(
    collection(db, getCustomerOrdersCollectionPath(user.uid)),
    where('status', 'in', [...PENDING_ORDER_STATUSES])
  );

  const [storeResult, tenantResult, ordersResult, orderCountResult] =
    await Promise.allSettled([
      storePromise,
      tenantPromise,
      getDocs(pendingOrdersQuery),
      getCountFromServer(pendingOrderCountQuery),
    ]);

  if (storeResult.status === 'fulfilled') {
    storeAvailable = true;
    if (storeResult.value.exists()) {
      store = storeSummaryFrom(
        user,
        storeResult.value.data() as Record<string, unknown>
      );
    }
  } else {
    warnings.push('Não foi possível consultar os dados privados da loja.');
  }

  if (tenantResult.status === 'fulfilled') {
    productsAvailable = true;
    const parsedProducts = parsePublicProducts(
      tenantResult.value.data()?.publicProducts
    );
    productCount = parsedProducts.length;
    productsTruncated = productCount > MAX_PRODUCTS_IN_CONTEXT;
    products = parsedProducts
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'))
      .slice(0, MAX_PRODUCTS_IN_CONTEXT)
      .map(productSummaryFrom);
  } else {
    warnings.push('Não foi possível consultar o catálogo da loja.');
  }

  if (ordersResult.status === 'fulfilled') {
    ordersAvailable = true;
    pendingOrders = ordersResult.value.docs
      .flatMap(snapshot => {
        const parsed = parseCustomerOrder(snapshot.data());
        return parsed ? [parsed] : [];
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map(orderSummaryFrom);
  } else {
    warnings.push('Não foi possível consultar os pedidos pendentes.');
  }

  if (orderCountResult.status === 'fulfilled') {
    pendingOrderCount = orderCountResult.value.data().count;
    ordersTruncated = pendingOrderCount > pendingOrders.length;
  } else {
    pendingOrderCount = pendingOrders.length;
    ordersTruncated = ordersResult.status === 'fulfilled' &&
      pendingOrders.length >= MAX_PENDING_ORDERS_IN_CONTEXT;
    warnings.push('A contagem total de pedidos pendentes não pôde ser confirmada.');
  }

  const value: KyrubErpContextSnapshot = {
    source: 'authenticated_client_snapshot',
    generatedAt: new Date().toISOString(),
    store,
    products,
    productCount,
    productsTruncated,
    pendingOrders,
    pendingOrderCount,
    ordersTruncated,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    availability: {
      store: storeAvailable,
      products: productsAvailable,
      orders: ordersAvailable,
    },
    warnings,
  };

  contextCache.set(user.uid, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  });

  return value;
};
