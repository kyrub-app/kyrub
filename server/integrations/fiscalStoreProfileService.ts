import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebaseAdmin.js';

const clean = (value: unknown, maxLength = 180): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const digits = (value: unknown, maxLength: number): string =>
  clean(value, maxLength).replace(/\D/g, '').slice(0, maxLength);

export type FiscalTaxRegime = 'simples_nacional' | 'lucro_presumido' | 'lucro_real' | 'mei';

export interface FiscalStoreProfile {
  schemaVersion: 1;
  storeId: string;
  ownerId: string;
  legalName: string;
  cnpj: string;
  stateRegistration: string;
  municipalRegistration: string;
  taxRegime: FiscalTaxRegime;
  address: {
    street: string;
    number: string;
    complement: string;
    district: string;
    city: string;
    state: string;
    postalCode: string;
  };
}

const profileRef = (ownerId: string, storeId: string) =>
  adminDb.doc(`users/${ownerId}/stores/${storeId}/fiscal/profile`);

const assertPrimaryOwnedStore = async (ownerId: string, storeId: string) => {
  if (!ownerId || !storeId || ownerId !== storeId) throw new Error('FISCAL_PROFILE_FORBIDDEN');
  const snapshot = await adminDb.doc(`users/${ownerId}/stores/${storeId}`).get();
  if (!snapshot.exists) throw new Error('FISCAL_PROFILE_STORE_NOT_FOUND');
  const data = snapshot.data();
  if (data?.ownerId !== ownerId || data?.id !== storeId) throw new Error('FISCAL_PROFILE_STORE_IDENTITY_INVALID');
};

const parseTaxRegime = (value: unknown): FiscalTaxRegime => {
  if (value === 'simples_nacional' || value === 'lucro_presumido' || value === 'lucro_real' || value === 'mei') return value;
  throw new Error('FISCAL_PROFILE_TAX_REGIME_INVALID');
};

const validateCnpj = (value: unknown): string => {
  const cnpj = digits(value, 14);
  if (cnpj.length !== 14) throw new Error('FISCAL_PROFILE_CNPJ_INVALID');
  return cnpj;
};

export const loadFiscalStoreProfile = async (input: { ownerId: string; storeId: string }): Promise<FiscalStoreProfile | null> => {
  await assertPrimaryOwnedStore(input.ownerId, input.storeId);
  const snapshot = await profileRef(input.ownerId, input.storeId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as FiscalStoreProfile;
  if (data.ownerId !== input.ownerId || data.storeId !== input.storeId) throw new Error('FISCAL_PROFILE_STORED_IDENTITY_INVALID');
  return data;
};

export const saveFiscalStoreProfile = async (input: {
  ownerId: string;
  storeId: string;
  profile: Record<string, unknown>;
}): Promise<FiscalStoreProfile> => {
  await assertPrimaryOwnedStore(input.ownerId, input.storeId);
  const address = (input.profile.address ?? {}) as Record<string, unknown>;
  const legalName = clean(input.profile.legalName);
  if (!legalName) throw new Error('FISCAL_PROFILE_LEGAL_NAME_REQUIRED');
  const state = clean(address.state, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error('FISCAL_PROFILE_STATE_INVALID');
  const postalCode = digits(address.postalCode, 8);
  if (postalCode.length !== 8) throw new Error('FISCAL_PROFILE_POSTAL_CODE_INVALID');

  const profile: FiscalStoreProfile = {
    schemaVersion: 1,
    storeId: input.storeId,
    ownerId: input.ownerId,
    legalName,
    cnpj: validateCnpj(input.profile.cnpj),
    stateRegistration: clean(input.profile.stateRegistration, 32),
    municipalRegistration: clean(input.profile.municipalRegistration, 32),
    taxRegime: parseTaxRegime(input.profile.taxRegime),
    address: {
      street: clean(address.street),
      number: clean(address.number, 32),
      complement: clean(address.complement, 100),
      district: clean(address.district, 100),
      city: clean(address.city, 100),
      state,
      postalCode,
    },
  };
  if (!profile.address.street || !profile.address.number || !profile.address.district || !profile.address.city) {
    throw new Error('FISCAL_PROFILE_ADDRESS_INCOMPLETE');
  }

  await profileRef(input.ownerId, input.storeId).set({
    ...profile,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return profile;
};
