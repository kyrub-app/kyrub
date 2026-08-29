import { adminDb } from '../firebaseAdmin.js';
import {
  buildStoreInstitutionalRepresentation,
  projectStoreInstitutionalIdentity,
  type StoreInstitutionalRepresentation,
} from '../../shared/storeInstitutionalIdentity.js';
import { getPrimaryUserStoreDocumentPath } from '../../src/utils/storePaths.js';

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export const loadOwnerStoreInstitutionalRepresentation = async (input: {
  storeId: string;
  authenticatedUserId: string;
}): Promise<StoreInstitutionalRepresentation> => {
  const storeId = clean(input.storeId);
  const authenticatedUserId = clean(input.authenticatedUserId);
  if (!storeId) throw new Error('STORE_INSTITUTIONAL_ID_REQUIRED');
  if (!authenticatedUserId) throw new Error('STORE_REPRESENTATION_USER_REQUIRED');
  if (authenticatedUserId !== storeId) {
    throw new Error('STORE_REPRESENTATION_FORBIDDEN');
  }

  const snapshot = await adminDb
    .doc(getPrimaryUserStoreDocumentPath(storeId))
    .get();
  if (!snapshot.exists) throw new Error('STORE_INSTITUTIONAL_NOT_FOUND');

  const data = snapshot.data() as Record<string, unknown>;
  if (
    clean(data.id) !== storeId ||
    clean(data.ownerId) !== authenticatedUserId
  ) {
    throw new Error('STORE_INSTITUTIONAL_SCOPE_INVALID');
  }

  const identity = projectStoreInstitutionalIdentity({
    ...data,
    storeId,
  });

  return buildStoreInstitutionalRepresentation({
    identity,
    authenticatedUserId,
    role: 'owner',
  });
};
