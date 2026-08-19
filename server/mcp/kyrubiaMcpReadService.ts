import { adminDb } from '../firebaseAdmin.js';
import type { KyrubMcpPrincipal } from './kyrubiaMcpAuth.js';
import type { KyrubMcpToolName } from '../../shared/kyrubiaMcp.js';

const PENDING_ORDER_STATUSES = new Set([
  'pending',
  'accepted',
  'preparing',
  'ready',
  'out_for_delivery',
]);

const cleanText = (value: unknown, maximum = 240): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maximum) : '';

const numberValue = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const limitFrom = (value: unknown, fallback: number, maximum: number): number => {
  const numeric = typeof value === 'number' ? Math.floor(value) : fallback;
  return Math.max(1, Math.min(maximum, Number.isFinite(numeric) ? numeric : fallback));
};

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim();

const readStore = async (uid: string): Promise<Record<string, unknown>> => {
  const snapshot = await adminDb.doc(`users/${uid}/stores/${uid}`).get();
  if (!snapshot.exists) return { configured: false, store: null };
  const data = snapshot.data() ?? {};
  return {
    configured: Boolean(cleanText(data.name, 120)),
    store: {
      id: uid,
      name: cleanText(data.name, 120),
      description: cleanText(data.description, 1000),
      address: cleanText(data.address, 240),
      contact: cleanText(data.contact, 160),
      plan: cleanText(data.plan, 32) || 'free',
      status: cleanText(data.status, 32) || 'closed',
      keywords: Array.isArray(data.keywords)
        ? data.keywords.map(item => cleanText(item, 60)).filter(Boolean).slice(0, 30)
        : [],
    },
  };
};

const readProducts = async (
  uid: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const snapshot = await adminDb.doc(`tenants/${uid}`).get();
  const data = snapshot.data() ?? {};
  const raw = Array.isArray(data.publicProducts) ? data.publicProducts : [];
  const queryText = normalize(cleanText(args.query, 160));
  const limit = limitFrom(args.limit, 20, 50);
  const items = raw
    .flatMap((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const product = value as Record<string, unknown>;
      const name = cleanText(product.name, 180);
      if (!name || (queryText && !normalize(name).includes(queryText))) return [];
      return [{
        id: cleanText(product.id, 180),
        name,
        description: cleanText(product.description, 1000),
        category: cleanText(product.category, 240),
        price: Math.max(0, numberValue(product.price)),
        stock: Math.max(0, numberValue(product.stock)),
        isService: product.isService === true,
        published: product.published !== false,
      }];
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  return { total: items.length, items: items.slice(0, limit), truncated: items.length > limit };
};

const readInventory = async (
  uid: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const snapshot = await adminDb.doc(`users/${uid}/private_store/inventory`).get();
  const data = snapshot.data() ?? {};
  const raw = Array.isArray(data.inventoryCatalog)
    ? data.inventoryCatalog
    : Array.isArray(data.catalog)
      ? data.catalog
      : [];
  const requested = Array.isArray(args.names)
    ? new Set(args.names.map(value => normalize(cleanText(value, 180))).filter(Boolean))
    : new Set<string>();
  const limit = limitFrom(args.limit, 50, 100);
  const items = raw.flatMap((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const name = cleanText(item.name, 180);
    if (!name) return [];
    const normalizedName = normalize(name);
    if (
      requested.size > 0 &&
      ![...requested].some(candidate =>
        normalizedName.includes(candidate) || candidate.includes(normalizedName)
      )
    ) {
      return [];
    }
    return [{
      id: cleanText(item.id, 180),
      name,
      unit: cleanText(item.unit, 12),
      currentQuantity: Math.max(0, numberValue(item.currentQuantity)),
      minimumQuantity: Math.max(0, numberValue(item.minimumQuantity)),
      purchaseCost: Math.max(0, numberValue(item.purchaseCost)),
      supplier: cleanText(item.supplier, 160),
      updatedAt: cleanText(item.updatedAt, 80),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  return { total: items.length, items: items.slice(0, limit), truncated: items.length > limit };
};

const readPendingOrders = async (
  uid: string,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const limit = limitFrom(args.limit, 20, 30);
  const snapshot = await adminDb
    .collection(`artifacts/${uid}/public/data/customerOrders`)
    .limit(100)
    .get();
  const items = snapshot.docs.flatMap(document => {
    const order = document.data();
    const status = cleanText(order.status, 48);
    if (!PENDING_ORDER_STATUSES.has(status)) return [];
    const rawItems = Array.isArray(order.items) ? order.items : [];
    return [{
      id: cleanText(order.id, 180) || document.id,
      status,
      paymentStatus: cleanText(order.paymentStatus, 48),
      fulfillmentType: cleanText(order.fulfillmentType, 48),
      total: Math.max(0, numberValue(order.total)),
      itemCount: rawItems.reduce((total: number, value: unknown) => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) return total;
        return total + Math.max(0, numberValue((value as Record<string, unknown>).quantity));
      }, 0),
      createdAt: cleanText(order.createdAt, 80),
    }];
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { total: items.length, items: items.slice(0, limit), truncated: items.length > limit };
};

export const callKyrubMcpReadTool = async (
  principal: KyrubMcpPrincipal,
  tool: KyrubMcpToolName,
  args: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  switch (tool) {
    case 'kyrub_get_store':
      return readStore(principal.uid);
    case 'kyrub_list_products':
      return readProducts(principal.uid, args);
    case 'kyrub_get_inventory':
      return readInventory(principal.uid, args);
    case 'kyrub_list_pending_orders':
      return readPendingOrders(principal.uid, args);
  }
};
