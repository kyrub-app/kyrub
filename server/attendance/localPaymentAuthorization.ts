import { hasStorePermission, parseStoreMember } from '../../src/utils/storeSecurity.js';

/** Revalidate live membership for each payment operation; never trust a client role. */
export const canCreateLocalStorePayment = async (input: {
  actorUserId: string;
  legacyStoreId: string;
  canonicalStoreId: string;
  readMember?: (canonicalStoreId: string, actorUserId: string) => Promise<unknown>;
}): Promise<boolean> => {
  const { actorUserId, legacyStoreId, canonicalStoreId } = input;
  if (!actorUserId || !legacyStoreId || !canonicalStoreId) return false;
  if (actorUserId === legacyStoreId) return true;
  const memberData = input.readMember
    ? await input.readMember(canonicalStoreId, actorUserId)
    : await (await import('../firebaseAdmin.js')).adminDb.doc(`stores/${canonicalStoreId}/members/${actorUserId}`).get().then(snapshot => snapshot.data());
  const member = parseStoreMember(memberData);
  return Boolean(member && member.storeId === canonicalStoreId && member.userId === actorUserId && member.status === 'active' && hasStorePermission(member.role, 'payments.create'));
};
