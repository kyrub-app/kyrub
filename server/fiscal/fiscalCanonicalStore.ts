import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

const cleanId = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, 160) : '';

export const canonicalStoreDocumentPath = (ownerId: string, storeId: string): string =>
  `users/${ownerId}/stores/${storeId}`;

export const canonicalFiscalProfilePath = (ownerId: string, storeId: string): string =>
  `${canonicalStoreDocumentPath(ownerId, storeId)}/fiscal/profile`;

const legacyFiscalProfilePath = (storeId: string): string =>
  `stores/${storeId}/fiscal/profile`;

export const assertCanonicalOwnedStore = async (input: {
  ownerId: string;
  storeId: string;
}): Promise<void> => {
  const ownerId = cleanId(input.ownerId);
  const storeId = cleanId(input.storeId);
  if (!ownerId || !storeId || ownerId !== storeId) {
    throw new Error('FISCAL_STORE_OWNERSHIP_REQUIRED');
  }

  const snapshot = await adminDb.doc(canonicalStoreDocumentPath(ownerId, storeId)).get();
  if (!snapshot.exists) throw new Error('FISCAL_STORE_NOT_FOUND');

  const data = snapshot.data() ?? {};
  if (data.ownerId !== ownerId || data.id !== storeId) {
    throw new Error('FISCAL_STORE_IDENTITY_INVALID');
  }
};

export const loadCanonicalFiscalProfileData = async (
  ownerIdInput: string,
  storeIdInput: string
): Promise<Record<string, unknown>> => {
  const ownerId = cleanId(ownerIdInput);
  const storeId = cleanId(storeIdInput);
  const canonicalRef = adminDb.doc(canonicalFiscalProfilePath(ownerId, storeId));
  const canonicalSnapshot = await canonicalRef.get();
  if (canonicalSnapshot.exists) return canonicalSnapshot.data() ?? {};

  const legacyPath = legacyFiscalProfilePath(storeId);
  const legacySnapshot = await adminDb.doc(legacyPath).get();
  if (!legacySnapshot.exists) return {};

  const legacyData = legacySnapshot.data() ?? {};
  await canonicalRef.set({
    ...legacyData,
    migratedFromLegacyPath: legacyPath,
    migratedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return legacyData;
};
