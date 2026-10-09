import { adminDb } from '../firebaseAdmin.js';
import { hasStorePermission, parseStoreMember } from '../../src/utils/storeSecurity.js';

/** Revalidate live membership for each payment operation; never trust a client role. */
export const canCreateLocalStorePayment = async (input: {
  actorUserId: string;
  legacyStoreId: string;
  canonicalStoreId: string;
}): Promise<boolean> => {
  const { actorUserId, legacyStoreId, canonicalStoreId } = input;
  if (!actorUserId || !legacyStoreId || !canonicalStoreId) return false;
  if (actorUserId === legacyStoreId) return true;
  const snapshot = await adminDb.doc(`stores/${canonicalStoreId}/members/${actorUserId}`).get();
  const member = parseStoreMember(snapshot.data());
  return Boolean(member && member.storeId === canonicalStoreId && member.userId === actorUserId && member.status === 'active' && hasStorePermission(member.role, 'payments.create'));
};
