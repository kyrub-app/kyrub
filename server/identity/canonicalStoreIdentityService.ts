import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number'
    ? String(value).trim()
    : '';

const safeIdentity = (value: unknown): string => {
  const normalized = clean(value);
  return normalized && normalized.length <= 180 && !normalized.includes('/')
    ? normalized
    : '';
};

export class CanonicalStoreIdentityError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'CanonicalStoreIdentityError';
  }
}

export interface CanonicalStoreIdentity {
  canonicalStoreId: string;
  ownerUserId: string;
  legacyStoreId: string;
  storeName: string;
}

export interface ResolveCanonicalStoreIdentityOptions {
  requirePublishedTenant?: boolean;
}

const fail = (status: number, code: string, message: string): never => {
  throw new CanonicalStoreIdentityError(status, code, message);
};

export const resolveCanonicalStoreIdentity = async (
  storeReference: unknown,
  options: ResolveCanonicalStoreIdentityOptions = {}
): Promise<CanonicalStoreIdentity> => {
  const input = safeIdentity(storeReference);
  if (!input) {
    fail(400, 'CANONICAL_STORE_REQUIRED', 'A loja não foi identificada.');
  }

  const direct = await adminDb.doc(`stores/${input}`).get();
  let canonical = direct;

  if (!direct.exists) {
    const matches = await adminDb
      .collection('stores')
      .where('legacyTenantId', '==', input)
      .limit(2)
      .get();

    if (matches.empty) {
      fail(404, 'CANONICAL_STORE_NOT_FOUND', 'A loja não foi encontrada.');
    }
    if (matches.size !== 1) {
      fail(409, 'CANONICAL_STORE_AMBIGUOUS', 'A identidade da loja está ambígua.');
    }
    canonical = matches.docs[0];
  }

  const data = canonical.data() as Record<string, unknown>;
  const canonicalStoreId = safeIdentity(canonical.id);
  const ownerUserId = safeIdentity(data.ownerId);
  const legacyStoreId = safeIdentity(data.legacyTenantId) || ownerUserId;

  if (
    !canonicalStoreId ||
    !ownerUserId ||
    !legacyStoreId ||
    legacyStoreId !== ownerUserId
  ) {
    fail(
      409,
      'CANONICAL_STORE_IDENTITY_INVALID',
      'A identidade canônica da loja está inconsistente.'
    );
  }

  if (options.requirePublishedTenant !== false) {
    const tenant = await adminDb.doc(`tenants/${legacyStoreId}`).get();
    if (!tenant.exists || clean(tenant.data()?.publicationStatus) !== 'published') {
      fail(
        404,
        'CANONICAL_STORE_UNAVAILABLE',
        'A loja não está disponível no marketplace.'
      );
    }
  }

  return {
    canonicalStoreId,
    ownerUserId,
    legacyStoreId,
    storeName: clean(data.name),
  };
};
