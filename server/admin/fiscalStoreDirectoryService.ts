import { adminDb } from '../firebaseAdmin.js';
import { authorizeIntegrationReadiness } from './integrationReadinessService.js';

const clean = (value: unknown, maxLength = 160): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

export interface AdminFiscalStoreDirectoryItem {
  canonicalStoreId: string;
  displayName: string;
  enrollmentStatus: 'not_prepared' | 'prepared' | 'production_authorized' | 'suspended';
}

const enrollmentStatus = (value: unknown): AdminFiscalStoreDirectoryItem['enrollmentStatus'] =>
  value === 'prepared' || value === 'production_authorized' || value === 'suspended'
    ? value
    : 'not_prepared';

export const loadAuthorizedFiscalStoreDirectory = async (
  authorization: string
): Promise<{ stores: AdminFiscalStoreDirectoryItem[] }> => {
  await authorizeIntegrationReadiness(authorization);

  const [storesSnapshot, enrollmentsSnapshot] = await Promise.all([
    adminDb.collection('stores').select('name', 'storeName', 'displayName').limit(200).get(),
    adminDb.collection('kyrub_admin/control_plane/fiscal_store_enrollments').select('status').get(),
  ]);

  const enrollmentByStore = new Map(
    enrollmentsSnapshot.docs.map(document => [document.id, enrollmentStatus(document.data().status)])
  );

  const stores = storesSnapshot.docs.map(document => {
    const data = document.data() as Record<string, unknown>;
    const displayName = clean(data.displayName) || clean(data.storeName) || clean(data.name) || 'Loja sem nome';
    return {
      canonicalStoreId: document.id,
      displayName,
      enrollmentStatus: enrollmentByStore.get(document.id) ?? 'not_prepared',
    } satisfies AdminFiscalStoreDirectoryItem;
  }).sort((left, right) => left.displayName.localeCompare(right.displayName, 'pt-BR'));

  return { stores };
};
