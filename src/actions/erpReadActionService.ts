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
  KyrubErpInventoryMovementLine,
  KyrubErpInventoryMovementSummary,
  KyrubErpInventorySummary,
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
const MAX_INVENTORY_IN_CONTEXT = 200;
const MAX_INVENTORY_MOVEMENTS_IN_CONTEXT = 20;
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

const cleanText = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isInventoryUnit = (
  value: unknown
): value is KyrubErpInventorySummary['unit'] =>
  value === 'un' || value === 'kg' || value === 'g' || value === 'l' || value === 'ml';

const inventorySummaryFrom = (value: unknown): KyrubErpInventorySummary | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = cleanText(candidate.id, 180);
  const name = cleanText(candidate.name, 180);
  const unit = candidate.unit;
  const currentQuantity = finiteNumber(candidate.currentQuantity);
  const minimumQuantity = finiteNumber(candidate.minimumQuantity);

  if (!id || !name || !isInventoryUnit(unit) || currentQuantity === null) return null;

  return {
    id,
    name,
    unit,
    currentQuantity: Math.max(0, currentQuantity),
    minimumQuantity: Math.max(0, minimumQuantity ?? 0),
    purchaseCost: Math.max(0, finiteNumber(candidate.purchaseCost) ?? 0),
    supplier: cleanText(candidate.supplier, 160),
    updatedAt: cleanText(candidate.updatedAt, 80),
  };
};

const inventoryMovementLineFrom = (
  value: unknown
): KyrubErpInventoryMovementLine | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const itemId = cleanText(candidate.itemId, 180);
  const name = cleanText(candidate.name, 180);
  const unit = candidate.unit;
  const quantityDelta = finiteNumber(candidate.quantityDelta);
  const previousQuantity = finiteNumber(candidate.previousQuantity);
  const resultingQuantity = finiteNumber(candidate.resultingQuantity);
  if (
    !itemId || !name || !isInventoryUnit(unit) || quantityDelta === null ||
    previousQuantity === null || resultingQuantity === null
  ) return null;
  return {
    itemId,
    name,
    unit,
    quantityDelta,
    previousQuantity: Math.max(0, previousQuantity),
    resultingQuantity: Math.max(0, resultingQuantity),
  };
};

const inventoryMovementSummaryFrom = (
  value: unknown
): KyrubErpInventoryMovementSummary | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = cleanText(candidate.id, 180);
  const kind = candidate.kind;
  const mode = candidate.mode;
  const createdAt = cleanText(candidate.createdAt, 80);
  if (
    !id || !createdAt ||
    (kind !== 'intake' && kind !== 'outflow' && kind !== 'loss' && kind !== 'correction') ||
    (mode !== 'increment' && mode !== 'decrement' && mode !== 'set')
  ) return null;
  const lines = Array.isArray(candidate.lines)
    ? candidate.lines
        .map(inventoryMovementLineFrom)
        .filter((line): line is KyrubErpInventoryMovementLine => Boolean(line))
        .slice(0, 12)
    : [];
  const entryCount = finiteNumber(candidate.entryCount);
  return {
    id,
    kind,
    mode,
    sourceKind: cleanText(candidate.sourceKind, 80),
    sourceLabel: cleanText(candidate.sourceLabel, 180),
    entryCount: Math.max(0, Math.trunc(entryCount ?? lines.length)),
    createdAt,
    lines,
    linesTruncated: candidate.linesTruncated === true,
  };
};

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
  let inventory: KyrubErpInventorySummary[] = [];
  let inventoryCount = 0;
  let inventoryTruncated = false;
  let inventoryMovements: KyrubErpInventoryMovementSummary[] = [];
  let inventoryMovementCount = 0;
  let inventoryMovementsTruncated = false;
  let pendingOrders: KyrubErpOrderSummary[] = [];
  let pendingOrderCount = 0;
  let ordersTruncated = false;
  let storeAvailable = false;
  let productsAvailable = false;
  let inventoryAvailable = false;
  let inventoryMovementsAvailable = false;
  let ordersAvailable = false;

  const storePromise = getDoc(
    doc(db, getPrimaryUserStoreDocumentPath(user.uid))
  );
  const tenantPromise = getDoc(doc(db, 'tenants', user.uid));
  const inventoryPromise = getDoc(doc(db, 'users', user.uid, 'private_store', 'inventory'));
  const pendingOrdersQuery = query(
    collection(db, getCustomerOrdersCollectionPath(user.uid)),
    where('status', 'in', [...PENDING_ORDER_STATUSES]),
    limit(MAX_PENDING_ORDERS_IN_CONTEXT)
  );
  const pendingOrderCountQuery = query(
    collection(db, getCustomerOrdersCollectionPath(user.uid)),
    where('status', 'in', [...PENDING_ORDER_STATUSES])
  );

  const [storeResult, tenantResult, inventoryResult, ordersResult, orderCountResult] =
    await Promise.allSettled([
      storePromise,
      tenantPromise,
      inventoryPromise,
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

  if (inventoryResult.status === 'fulfilled') {
    inventoryAvailable = true;
    inventoryMovementsAvailable = true;
    const inventoryData = inventoryResult.value.data() as Record<string, unknown> | undefined;
    const rawInventory = Array.isArray(inventoryData?.inventoryCatalog)
      ? inventoryData.inventoryCatalog
      : Array.isArray(inventoryData?.catalog)
        ? inventoryData.catalog
        : [];
    const parsedInventory = rawInventory
      .map(inventorySummaryFrom)
      .filter((item): item is KyrubErpInventorySummary => Boolean(item))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
    inventoryCount = parsedInventory.length;
    inventoryTruncated = inventoryCount > MAX_INVENTORY_IN_CONTEXT;
    inventory = parsedInventory.slice(0, MAX_INVENTORY_IN_CONTEXT);

    const rawMovements = Array.isArray(inventoryData?.recentInventoryMovements)
      ? inventoryData.recentInventoryMovements
      : [];
    inventoryMovements = rawMovements
      .map(inventoryMovementSummaryFrom)
      .filter((movement): movement is KyrubErpInventoryMovementSummary => Boolean(movement))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, MAX_INVENTORY_MOVEMENTS_IN_CONTEXT);
    inventoryMovementCount = inventoryMovements.length;
    inventoryMovementsTruncated =
      inventoryData?.recentInventoryMovementsTruncated === true ||
      rawMovements.length > MAX_INVENTORY_MOVEMENTS_IN_CONTEXT;
  } else {
    warnings.push('Não foi possível consultar o estoque privado de insumos.');
    warnings.push('Não foi possível consultar o histórico recente do estoque.');
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
    inventory,
    inventoryCount,
    inventoryTruncated,
    inventoryMovements,
    inventoryMovementCount,
    inventoryMovementsTruncated,
    pendingOrders,
    pendingOrderCount,
    ordersTruncated,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    availability: {
      store: storeAvailable,
      products: productsAvailable,
      inventory: inventoryAvailable,
      inventoryMovements: inventoryMovementsAvailable,
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
