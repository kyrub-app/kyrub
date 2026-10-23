import { adminDb } from '../firebaseAdmin.js';
import {
  calculatePaidStoreConversion,
  countActivePaidOwners,
} from '../../shared/ecosystemFunnelMetrics.js';

export interface EcosystemFunnelCounts {
  users: number | null;
  canonicalStores: number | null;
  activePaidOwners: number | null;
  paidStoreConversionPercent: number | null;
}

/**
 * Internal data reader only. Call exclusively after the existing
 * administrative authentication and authorization checks.
 * Do not mount in tenant-scoped CRM routes.
 */
export async function readEcosystemFunnelCounts(): Promise<EcosystemFunnelCounts> {
  const results = await Promise.allSettled([
    adminDb.collection('users').count().get(),
    adminDb.collection('stores').count().get(),
    adminDb.collection('kyrub_admin/control_plane/store_entitlements').get(),
  ]);
  const users = results[0].status === 'fulfilled' ? results[0].value.data().count : null;
  const canonicalStores = results[1].status === 'fulfilled' ? results[1].value.data().count : null;
  const activePaidOwners = results[2].status === 'fulfilled'
    ? countActivePaidOwners(results[2].value.docs.map(doc => ({
        ...doc.data(),
        ownerId: doc.id,
      })))
    : null;
  return {
    users,
    canonicalStores,
    activePaidOwners,
    paidStoreConversionPercent: calculatePaidStoreConversion(activePaidOwners, canonicalStores),
  };
}
