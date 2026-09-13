import { adminDb } from '../firebaseAdmin.js';

const MAX_PRODUCT_ID_CHARACTERS = 180;
const MAX_PRODUCT_NAME_CHARACTERS = 180;
const MAX_STORE_ID_CHARACTERS = 180;

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';

const normalizeName = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

export type AuthoritativeProductIdentity = {
  id: string;
  name: string;
};

export type AuthoritativeProductIdentityResolution =
  | { status: 'found'; product: AuthoritativeProductIdentity }
  | { status: 'not_found' }
  | { status: 'ambiguous'; matches: AuthoritativeProductIdentity[] };

export type CanonicalProductIdentityCandidate = {
  id: string;
  data: unknown;
};

export const resolveOwnedProductIdentityFromCanonicalProducts = (input: {
  canonicalStoreId: string;
  targetName: string;
  canonicalProducts: CanonicalProductIdentityCandidate[];
}): AuthoritativeProductIdentityResolution => {
  const canonicalStoreId = clean(input.canonicalStoreId, MAX_STORE_ID_CHARACTERS);
  const expected = normalizeName(clean(input.targetName, MAX_PRODUCT_NAME_CHARACTERS));
  if (!canonicalStoreId || !expected) return { status: 'not_found' };

  const matches = input.canonicalProducts.flatMap(candidate => {
    const product = record(candidate.data);
    if (!product) return [];
    const documentId = clean(candidate.id, MAX_PRODUCT_ID_CHARACTERS);
    const storedId = clean(product.id, MAX_PRODUCT_ID_CHARACTERS);
    const storeId = clean(product.storeId, MAX_STORE_ID_CHARACTERS);
    const name = clean(product.name, MAX_PRODUCT_NAME_CHARACTERS);
    if (
      !documentId ||
      documentId.includes('/') ||
      storedId !== documentId ||
      storeId !== canonicalStoreId ||
      !name ||
      normalizeName(name) !== expected
    ) {
      return [];
    }
    return [{ id: documentId, name }];
  });

  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'ambiguous', matches };
  return { status: 'found', product: matches[0] };
};

export const resolveOwnedProductIdentityFromPublicProducts = (input: {
  ownerUid: string;
  targetName: string;
  publicProducts: unknown[];
}): AuthoritativeProductIdentityResolution => {
  const expected = normalizeName(clean(input.targetName, MAX_PRODUCT_NAME_CHARACTERS));
  if (!expected) return { status: 'not_found' };

  const matches = input.publicProducts.flatMap(item => {
    const product = record(item);
    if (!product) return [];
    const id = clean(product.id, MAX_PRODUCT_ID_CHARACTERS);
    const name = clean(product.name, MAX_PRODUCT_NAME_CHARACTERS);
    if (
      !id ||
      id.includes('/') ||
      !name ||
      normalizeName(name) !== expected ||
      product.storeId !== input.ownerUid ||
      product.supplierId !== input.ownerUid
    ) {
      return [];
    }
    return [{ id, name }];
  });

  if (matches.length === 0) return { status: 'not_found' };
  if (matches.length > 1) return { status: 'ambiguous', matches };
  return { status: 'found', product: matches[0] };
};

const resolveLegacyProductIdentity = async (input: {
  ownerUid: string;
  targetName: string;
}): Promise<AuthoritativeProductIdentityResolution> => {
  const tenantSnapshot = await adminDb.doc(`tenants/${input.ownerUid}`).get();
  if (!tenantSnapshot.exists) return { status: 'not_found' };
  const tenantData = tenantSnapshot.data() as Record<string, unknown>;
  const publicProducts = Array.isArray(tenantData.publicProducts)
    ? tenantData.publicProducts
    : [];
  return resolveOwnedProductIdentityFromPublicProducts({
    ownerUid: input.ownerUid,
    targetName: input.targetName,
    publicProducts,
  });
};

export const resolveAuthoritativeOwnStoreProductByExactName = async (input: {
  ownerUid: string;
  targetName: string;
}): Promise<AuthoritativeProductIdentityResolution> => {
  const ownerUid = clean(input.ownerUid, MAX_STORE_ID_CHARACTERS);
  const targetName = clean(input.targetName, MAX_PRODUCT_NAME_CHARACTERS);
  if (!ownerUid || !targetName) return { status: 'not_found' };

  const privateStoreDoc = await adminDb.doc(`users/${ownerUid}/stores/${ownerUid}`).get();
  if (privateStoreDoc.exists) {
    const privateStore = privateStoreDoc.data() as Record<string, unknown>;
    const canonicalStoreId = clean(privateStore.canonicalStoreId, MAX_STORE_ID_CHARACTERS);
    if (canonicalStoreId) {
      const canonicalSnapshot = await adminDb
        .collection(`stores/${canonicalStoreId}/products`)
        .get();
      if (!canonicalSnapshot.empty) {
        return resolveOwnedProductIdentityFromCanonicalProducts({
          canonicalStoreId,
          targetName,
          canonicalProducts: canonicalSnapshot.docs.map(document => ({
            id: document.id,
            data: document.data(),
          })),
        });
      }
    }
  }

  // Compatibility fallback for accounts that have not reached the canonical
  // store/product cutover yet. Once the canonical catalog contains products,
  // legacy publicProducts is never allowed to override or duplicate identity.
  return resolveLegacyProductIdentity({ ownerUid, targetName });
};
