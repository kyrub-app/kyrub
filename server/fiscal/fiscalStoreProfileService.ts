import { FieldValue } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from '../ai/consultantAuth.js';
import { adminDb } from '../firebaseAdmin.js';
import {
  assertCanonicalOwnedStore,
  canonicalFiscalProfilePath,
  loadCanonicalFiscalProfileData,
} from './fiscalCanonicalStore.js';

const bearerToken = (authorization: string): string => /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim() ?? '';
const clean = (value: unknown, maxLength: number): string => typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
const digits = (value: unknown): string => clean(value, 32).replace(/\D/g, '');

const isValidCnpj = (value: string): boolean => {
  if (!/^\d{14}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const calculate = (base: string, weights: number[]): number => {
    const sum = base.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const first = calculate(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = calculate(value.slice(0, 12) + first, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${first}${second}`);
};

export interface FiscalStoreProfileView {
  canonicalStoreId: string;
  legalName: string;
  cnpj: string;
  stateRegistration: string;
  municipalRegistration: string;
  taxRegime: string;
  address: {
    street: string;
    number: string;
    complement: string;
    district: string;
    city: string;
    state: string;
    postalCode: string;
    ibgeCityCode: string;
  };
  completeness: 'pending' | 'complete';
  missingFields: string[];
  productionTrafficAllowed: false;
}

const authorizeOwnStore = async (authorization: string, canonicalStoreIdInput: unknown): Promise<string> => {
  const token = bearerToken(authorization);
  if (!token) throw new Error('AUTH_REQUIRED');
  const decoded = await verifyFirebaseIdToken(token);
  if (decoded.emailVerified !== true) throw new Error('EMAIL_NOT_VERIFIED');
  const canonicalStoreId = clean(canonicalStoreIdInput, 160);
  if (!canonicalStoreId) throw new Error('FISCAL_STORE_ENROLLMENT_INPUT_REQUIRED');
  if (canonicalStoreId !== decoded.uid) throw new Error('FISCAL_STORE_OWNERSHIP_REQUIRED');
  await assertCanonicalOwnedStore({ ownerId: decoded.uid, storeId: canonicalStoreId });
  return canonicalStoreId;
};

const viewFrom = (canonicalStoreId: string, data: Record<string, unknown>): FiscalStoreProfileView => {
  const addressRaw = data.address && typeof data.address === 'object' && !Array.isArray(data.address) ? data.address as Record<string, unknown> : {};
  const profile = {
    canonicalStoreId,
    legalName: clean(data.legalName, 180),
    cnpj: digits(data.cnpj),
    stateRegistration: clean(data.stateRegistration, 40),
    municipalRegistration: clean(data.municipalRegistration, 40),
    taxRegime: clean(data.taxRegime, 80),
    address: {
      street: clean(addressRaw.street, 160), number: clean(addressRaw.number, 30), complement: clean(addressRaw.complement, 80),
      district: clean(addressRaw.district, 100), city: clean(addressRaw.city, 100), state: clean(addressRaw.state, 2).toUpperCase(),
      postalCode: digits(addressRaw.postalCode).slice(0, 8), ibgeCityCode: digits(addressRaw.ibgeCityCode).slice(0, 7),
    },
  };
  const missingFields: string[] = [];
  if (!profile.legalName) missingFields.push('legalName');
  if (!isValidCnpj(profile.cnpj)) missingFields.push('cnpj');
  if (!profile.taxRegime) missingFields.push('taxRegime');
  for (const key of ['street', 'number', 'district', 'city', 'state', 'postalCode', 'ibgeCityCode'] as const) if (!profile.address[key]) missingFields.push(`address.${key}`);
  return { ...profile, completeness: missingFields.length ? 'pending' : 'complete', missingFields, productionTrafficAllowed: false };
};

export const loadOwnFiscalStoreProfile = async (input: { authorization: string; canonicalStoreId: unknown }): Promise<FiscalStoreProfileView> => {
  const canonicalStoreId = await authorizeOwnStore(input.authorization, input.canonicalStoreId);
  const data = await loadCanonicalFiscalProfileData(canonicalStoreId, canonicalStoreId);
  return viewFrom(canonicalStoreId, data);
};

export const saveOwnFiscalStoreProfile = async (input: { authorization: string; canonicalStoreId: unknown; profile: unknown }): Promise<FiscalStoreProfileView> => {
  const canonicalStoreId = await authorizeOwnStore(input.authorization, input.canonicalStoreId);
  const raw = input.profile && typeof input.profile === 'object' && !Array.isArray(input.profile) ? input.profile as Record<string, unknown> : {};
  const view = viewFrom(canonicalStoreId, raw);
  if (view.cnpj && !isValidCnpj(view.cnpj)) throw new Error('FISCAL_CNPJ_INVALID');
  if (view.address.state && !/^[A-Z]{2}$/.test(view.address.state)) throw new Error('FISCAL_UF_INVALID');
  if (view.address.postalCode && view.address.postalCode.length !== 8) throw new Error('FISCAL_POSTAL_CODE_INVALID');
  if (view.address.ibgeCityCode && view.address.ibgeCityCode.length !== 7) throw new Error('FISCAL_IBGE_CITY_CODE_INVALID');

  await adminDb.doc(canonicalFiscalProfilePath(canonicalStoreId, canonicalStoreId)).set({
    legalName: view.legalName, cnpj: view.cnpj, stateRegistration: view.stateRegistration,
    municipalRegistration: view.municipalRegistration, taxRegime: view.taxRegime, address: view.address,
    completeness: view.completeness, missingFields: view.missingFields,
    declaredByUserId: canonicalStoreId, updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  const auditId = crypto.randomUUID().replaceAll('-', '_');
  await adminDb.doc(`kyrub_admin/control_plane/audit_logs/${auditId}`).set({
    id: auditId, action: 'store.fiscal.profile.saved', actorId: canonicalStoreId, actorRole: 'store_owner',
    targetType: 'store', targetId: canonicalStoreId, completeness: view.completeness,
    source: 'server', createdAt: FieldValue.serverTimestamp(),
  });
  return view;
};

export const mapFiscalStoreProfileError = (error: unknown): { status: number; body: { error: string; code: string } } => {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'AUTH_REQUIRED' || /id-token|expired|revoked/i.test(message)) return { status: 401, body: { error: 'Faça login novamente.', code: 'AUTH_REQUIRED' } };
  if (message === 'EMAIL_NOT_VERIFIED' || message === 'FISCAL_STORE_OWNERSHIP_REQUIRED') return { status: 403, body: { error: 'Você não pode alterar os dados fiscais desta loja.', code: message } };
  if (message === 'FISCAL_STORE_NOT_FOUND') return { status: 404, body: { error: 'A loja autenticada não foi encontrada.', code: message } };
  if (message === 'FISCAL_STORE_IDENTITY_INVALID') return { status: 409, body: { error: 'A identidade canônica da loja está inconsistente.', code: message } };
  if (message === 'FISCAL_CNPJ_INVALID') return { status: 400, body: { error: 'Informe um CNPJ válido.', code: message } };
  if (message === 'FISCAL_UF_INVALID') return { status: 400, body: { error: 'Informe a UF com duas letras.', code: message } };
  if (message === 'FISCAL_POSTAL_CODE_INVALID') return { status: 400, body: { error: 'Informe um CEP com 8 dígitos.', code: message } };
  if (message === 'FISCAL_IBGE_CITY_CODE_INVALID') return { status: 400, body: { error: 'Informe o código IBGE do município com 7 dígitos.', code: message } };
  console.error('[Fiscal Store Profile]', error);
  return { status: 503, body: { error: 'Não foi possível salvar os dados fiscais agora.', code: 'FISCAL_STORE_PROFILE_FAILED' } };
};
