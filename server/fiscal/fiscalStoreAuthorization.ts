import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { assertCanonicalOwnedStore } from './fiscalCanonicalStore.js';

const bearerToken = (authorization: string): string =>
  /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';

const cleanStoreId = (value: unknown): string =>
  typeof value === 'string' ? value.trim().slice(0, 160) : '';

export interface AuthorizedFiscalStore {
  canonicalStoreId: string;
  actorId: string;
}

/**
 * Single tenant authorization boundary for merchant-facing Fiscal operations.
 * The current ERP authority is intentionally one owner uid == one canonical store id.
 */
export const authorizeOwnFiscalStore = async (input: {
  authorization: string;
  canonicalStoreId: unknown;
  storeRequiredCode?: string;
}): Promise<AuthorizedFiscalStore> => {
  const token = bearerToken(input.authorization);
  if (!token) throw new Error('AUTH_REQUIRED');

  const decoded = await verifyFirebaseIdToken(token);
  if (decoded.emailVerified !== true) throw new Error('EMAIL_NOT_VERIFIED');

  const canonicalStoreId = cleanStoreId(input.canonicalStoreId);
  if (!canonicalStoreId) {
    throw new Error(input.storeRequiredCode?.trim() || 'FISCAL_STORE_REQUIRED');
  }
  if (canonicalStoreId !== decoded.uid) {
    throw new Error('FISCAL_STORE_OWNERSHIP_REQUIRED');
  }

  await assertCanonicalOwnedStore({
    ownerId: decoded.uid,
    storeId: canonicalStoreId,
  });

  return {
    canonicalStoreId,
    actorId: decoded.uid,
  };
};
