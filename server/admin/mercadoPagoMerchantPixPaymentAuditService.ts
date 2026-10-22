import { adminDb } from '../firebaseAdmin.js';
import { loadMercadoPagoMerchantPixMigrationInventory } from './mercadoPagoMerchantPixMigrationInventoryService.js';

const MAX_PER_COLLECTION = 200;
const validId = (id: string): boolean => Boolean(id) && id.length <= 180 && !id.includes('/');

type AuditCategory = 'pending' | 'approved_or_accepted' | 'paid' | 'cancelled' | 'expired' | 'other';
type AuditCounts = Record<AuditCategory, number>;

const countStatuses = (records: Array<{ status?: unknown }>): AuditCounts => {
  const counts: AuditCounts = { pending: 0, approved_or_accepted: 0, paid: 0, cancelled: 0, expired: 0, other: 0 };
  for (const record of records) {
    const status = typeof record.status === 'string' ? record.status.toLowerCase() : '';
    if (['pending', 'created', 'awaiting_payment', 'awaiting_approval'].includes(status)) counts.pending++;
    else if (['accepted', 'approved_for_payment', 'confirmed'].includes(status)) counts.approved_or_accepted++;
    else if (['paid', 'approved', 'completed'].includes(status)) counts.paid++;
    else if (['cancelled', 'canceled', 'refunded'].includes(status)) counts.cancelled++;
    else if (['expired', 'rejected', 'failed'].includes(status)) counts.expired++;
    else counts.other++;
  }
  return counts;
};

export const loadMerchantPixStorePaymentAudit = async (requestedStoreId: string) => {
  if (!validId(requestedStoreId)) throw new Error('STORE_AUDIT_SCOPE_INVALID');
  const inventory = await loadMercadoPagoMerchantPixMigrationInventory();
  if (!inventory.complete) throw new Error('STORE_AUDIT_INVENTORY_INCOMPLETE');
  const matching = inventory.items.filter(row => row.canonicalStoreId === requestedStoreId);
  if (matching.length !== 1 || matching[0]?.readiness === 'identity_review') {
    throw new Error('STORE_AUDIT_SCOPE_UNVERIFIED');
  }
  const tenantId = matching[0].tenantId;
  if (!validId(tenantId)) throw new Error('STORE_AUDIT_SCOPE_INVALID');
  // Scoped reads only; never use collectionGroup queries that combine merchants.
  const roots = {
    orders: `artifacts/${tenantId}/public/data/customerOrders`,
    intents: `stores/${requestedStoreId}/paymentIntents`,
    payments: `stores/${requestedStoreId}/payments`,
  };
  const entries = await Promise.all(Object.values(roots).map(root =>
    adminDb.collection(root).limit(MAX_PER_COLLECTION + 1).get()
  ));
  const stats = entries.map(snapshot => ({
    scanned: Math.min(snapshot.size, MAX_PER_COLLECTION),
    complete: snapshot.size <= MAX_PER_COLLECTION,
    statuses: countStatuses(snapshot.docs.slice(0, MAX_PER_COLLECTION).map(doc => ({
      status: doc.data().status,
    }))),
  }));
  return {
    generatedAt: new Date().toISOString(),
    scope: 'single_published_store' as const,
    // No buyer identity, record IDs, transaction values or tokens in this output.
    storeId: requestedStoreId,
    complete: stats.every(x => x.complete),
    orders: stats[0],
    intents: stats[1],
    payments: stats[2],
    requiresProviderReconciliation: true as const,
    warning: 'Contagens por estado, não comprovação de conciliação, beneficiário ou ausência de Pix históricos fora destes caminhos.',
  };
};
