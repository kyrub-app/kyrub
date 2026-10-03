import { Router } from 'express';
import { adminDb } from '../firebaseAdmin.js';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { loadOwnerStoreInstitutionalRepresentation } from '../store/storeInstitutionalIdentityService.js';
import { orderCommercialSnapshotPath } from './orderCommercialSnapshotService.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
const requireOwner = async (authorization: string, storeId: string): Promise<void> => {
  const token = bearerToken(authorization); if (!token) throw new Error('AUTH_REQUIRED');
  const identity = await verifyFirebaseIdToken(token);
  await loadOwnerStoreInstitutionalRepresentation({ storeId, authenticatedUserId: identity.uid });
};
const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const finiteNumber = (value: unknown): number | null => { const parsed = typeof value === 'number' ? value : Number(value); return Number.isFinite(parsed) ? parsed : null; };
const firstNumber = (record: Record<string, unknown>, keys: string[]): number | null => { for (const key of keys) { const value = finiteNumber(record[key]); if (value !== null) return value; } return null; };
const firstText = (record: Record<string, unknown>, keys: string[]): string => { for (const key of keys) { const value = clean(record[key]); if (value) return value; } return ''; };
const orderItems = (data: Record<string, unknown>) => (Array.isArray(data.items) ? data.items : []).flatMap((value, index) => {
  const item = asRecord(value); if (!item) return [];
  const quantity = firstNumber(item, ['quantity', 'qty']) ?? 1;
  const unitAmountMinor = firstNumber(item, ['unitAmountMinor', 'unitPriceMinor', 'priceMinor']);
  const totalAmountMinor = firstNumber(item, ['totalAmountMinor', 'totalMinor', 'subtotalMinor']);
  const unitAmount = firstNumber(item, ['unitAmount', 'unitPrice', 'price']);
  const totalAmount = firstNumber(item, ['totalAmount', 'total', 'subtotal']);
  return [{ id: firstText(item, ['lineId', 'productId', 'id', 'sku']) || `item-${index + 1}`, name: firstText(item, ['name', 'title', 'productName', 'label']) || 'Item do pedido', quantity, unitAmountMinor: unitAmountMinor ?? (unitAmount !== null ? Math.round(unitAmount * 100) : null), totalAmountMinor: totalAmountMinor ?? (totalAmount !== null ? Math.round(totalAmount * 100) : null) }];
});
const promotionalEvidence = (data: Record<string, unknown>) => {
  const evidence: Array<{ field: string; value: unknown }> = [];
  const visit = (value: unknown, path: string, depth: number) => {
    if (depth > 4 || evidence.length >= 30) return;
    if (Array.isArray(value)) { value.slice(0, 30).forEach((entry, index) => visit(entry, `${path}[${index}]`, depth + 1)); return; }
    const record = asRecord(value); if (!record) return;
    for (const [key, child] of Object.entries(record)) {
      if (evidence.length >= 30) return;
      const childPath = path ? `${path}.${key}` : key;
      if (/(coupon|promo|discount|voucher)/i.test(key)) {
        if (child === null || ['string', 'number', 'boolean'].includes(typeof child)) evidence.push({ field: childPath, value: child });
        else if (Array.isArray(child)) evidence.push({ field: childPath, value: child.slice(0, 10) });
        else if (asRecord(child)) evidence.push({ field: childPath, value: Object.fromEntries(Object.entries(child as Record<string, unknown>).filter(([, nested]) => nested === null || ['string', 'number', 'boolean'].includes(typeof nested)).slice(0, 12)) });
      }
      visit(child, childPath, depth + 1);
    }
  };
  visit(data, '', 0); return evidence;
};
const loadOrder = async (storeId: string, orderId: string) => {
  const frozenRef = adminDb.doc(orderCommercialSnapshotPath(storeId, orderId));
  const canonicalRef = adminDb.doc(`stores/${storeId}/orders/${orderId}`);
  const operationalRef = adminDb.doc(`artifacts/${storeId}/public/data/customerOrders/${orderId}`);
  const [frozen, canonical, operational] = await Promise.all([frozenRef.get(), canonicalRef.get(), operationalRef.get()]);
  if (frozen.exists) {
    const wrapper = frozen.data() as Record<string, unknown>;
    const data = asRecord(wrapper.order);
    if (data) return { source: 'commercial_snapshot' as const, data, capturedAt: clean(wrapper.capturedAt) };
  }
  const snapshot = canonical.exists ? canonical : operational;
  if (!snapshot.exists) return null;
  const data = snapshot.data() as Record<string, unknown>;
  if (clean(data.storeId) && clean(data.storeId) !== storeId) return null;
  return { source: canonical.exists ? 'canonical' as const : 'operational' as const, data, capturedAt: '' };
};
export const createStoreCashTransactionDetailRouter = (): Router => {
  const router = Router();
  router.get('/', async (request, response) => {
    try {
      const storeId = clean(request.query.storeId); const orderId = clean(request.query.orderId);
      if (!storeId || !orderId) { response.status(400).json({ error: 'Loja e pedido são obrigatórios.' }); return; }
      await requireOwner(request.get('authorization') ?? '', storeId);
      const order = await loadOrder(storeId, orderId);
      if (!order) { response.status(404).json({ error: 'Pedido original não encontrado para esta transação.' }); return; }
      const data = order.data;
      response.status(200).json({ storeId, orderId, source: order.source, capturedAt: order.capturedAt, status: clean(data.status), paymentStatus: clean(data.paymentStatus), buyerName: clean(data.buyerName), buyerEmail: clean(data.buyerEmail), items: orderItems(data), promotionEvidence: promotionalEvidence(data) });
    } catch (error) {
      const code = error instanceof Error ? error.message : String(error);
      if (code === 'AUTH_REQUIRED') { response.status(401).json({ error: 'Faça login novamente.' }); return; }
      if (code === 'STORE_REPRESENTATION_FORBIDDEN') { response.status(403).json({ error: 'Você não pode consultar esta transação.' }); return; }
      console.error('[Cash transaction detail]', error); response.status(503).json({ error: 'Não foi possível carregar os detalhes desta transação agora.' });
    }
  });
  return router;
};
