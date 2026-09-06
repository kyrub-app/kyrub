import { adminDb } from '../firebaseAdmin.js';

const MAX_PRODUCT_ID_CHARACTERS = 180;
const MAX_PRODUCT_NAME_CHARACTERS = 180;

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

export const resolveAuthoritativeOwnStoreProductByExactName = async (input: {
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
