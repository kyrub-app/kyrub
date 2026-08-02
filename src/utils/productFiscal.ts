import type { User } from 'firebase/auth';
import {
  doc,
  runTransaction,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { db } from './firebase';
import { getProductInventoryDocumentPath } from './productInventory';

export const FISCAL_UNITS = [
  'UN',
  'KG',
  'G',
  'L',
  'ML',
  'CX',
  'PCT',
  'M',
  'M2',
  'M3',
] as const;

export const GOODS_ORIGIN_CODES = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
] as const;

export type FiscalUnit = (typeof FISCAL_UNITS)[number];
export type GoodsOriginCode = (typeof GOODS_ORIGIN_CODES)[number];
export type ProductFiscalKind = 'goods' | 'service';

export interface ProductFiscalProfile {
  enabled: boolean;
  kind: ProductFiscalKind;
  fiscalDescription: string;
  ncm: string;
  cest: string;
  gtin: string;
  noGtin: boolean;
  commercialUnit: FiscalUnit;
  taxUnit: FiscalUnit;
  conversionFactor: number;
  origin: GoodsOriginCode;
  serviceListCode: string;
  municipalServiceCode: string;
  nbs: string;
  updatedAt: string;
}

export interface ProductFiscalEditorState {
  ready: boolean;
  draft: ProductFiscalProfile;
  initialProfile: ProductFiscalProfile | null;
}

const clean = (value: unknown, maxLength = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const digits = (value: unknown, maxLength: number): string =>
  clean(value, maxLength).replace(/\D/g, '').slice(0, maxLength);

const finitePositive = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

const validProductId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,128}$/.test(value);

const isFiscalUnit = (value: unknown): value is FiscalUnit =>
  typeof value === 'string' && FISCAL_UNITS.includes(value as FiscalUnit);

const isOriginCode = (value: unknown): value is GoodsOriginCode =>
  typeof value === 'string' &&
  GOODS_ORIGIN_CODES.includes(value as GoodsOriginCode);

export const createEmptyProductFiscalProfile = (
  kind: ProductFiscalKind = 'goods'
): ProductFiscalProfile => ({
  enabled: false,
  kind,
  fiscalDescription: '',
  ncm: '',
  cest: '',
  gtin: '',
  noGtin: true,
  commercialUnit: 'UN',
  taxUnit: 'UN',
  conversionFactor: 1,
  origin: '0',
  serviceListCode: '',
  municipalServiceCode: '',
  nbs: '',
  updatedAt: '',
});

export const parseProductFiscalProfile = (
  value: unknown,
  fallbackKind: ProductFiscalKind = 'goods'
): ProductFiscalProfile | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const kind: ProductFiscalKind = candidate.kind === 'service'
    ? 'service'
    : fallbackKind;

  return {
    enabled: candidate.enabled === true,
    kind,
    fiscalDescription: clean(candidate.fiscalDescription, 200),
    ncm: digits(candidate.ncm, 8),
    cest: digits(candidate.cest, 7),
    gtin: digits(candidate.gtin, 14),
    noGtin: candidate.noGtin !== false,
    commercialUnit: isFiscalUnit(candidate.commercialUnit)
      ? candidate.commercialUnit
      : 'UN',
    taxUnit: isFiscalUnit(candidate.taxUnit) ? candidate.taxUnit : 'UN',
    conversionFactor: finitePositive(candidate.conversionFactor) ?? 1,
    origin: isOriginCode(candidate.origin) ? candidate.origin : '0',
    serviceListCode: clean(candidate.serviceListCode, 20),
    municipalServiceCode: clean(candidate.municipalServiceCode, 30),
    nbs: clean(candidate.nbs, 20),
    updatedAt: clean(candidate.updatedAt, 40),
  };
};

export const parseProductFiscalProfiles = (
  value: unknown
): Record<string, ProductFiscalProfile> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parsed: Record<string, ProductFiscalProfile> = {};

  for (const [productId, profile] of Object.entries(
    value as Record<string, unknown>
  )) {
    if (!validProductId(productId)) continue;
    const next = parseProductFiscalProfile(profile);
    if (next?.enabled) parsed[productId] = next;
  }

  return parsed;
};

export const readProductFiscalProfile = (
  value: DocumentData | undefined,
  productId: string,
  fallbackKind: ProductFiscalKind = 'goods'
): ProductFiscalProfile | null => {
  if (!validProductId(productId)) return null;
  const profiles = parseProductFiscalProfiles(value?.productFiscalProfiles);
  const profile = profiles[productId];
  return profile
    ? parseProductFiscalProfile(profile, fallbackKind)
    : null;
};

const hasValidGtinChecksum = (value: string): boolean => {
  if (![8, 12, 13, 14].includes(value.length) || !/^\d+$/.test(value)) {
    return false;
  }

  const digitsList = value.split('').map(Number);
  const checkDigit = digitsList.pop();
  if (typeof checkDigit !== 'number') return false;

  const sum = digitsList
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
};

export const normalizeProductFiscalProfile = (
  value: ProductFiscalProfile,
  kind: ProductFiscalKind
): ProductFiscalProfile | null => {
  if (!value.enabled) return null;

  const normalized = parseProductFiscalProfile({ ...value, kind }, kind);
  if (!normalized) throw new Error('Revise os dados fiscais deste item.');

  if (!normalized.fiscalDescription) {
    throw new Error('Informe a descrição fiscal do item.');
  }

  if (kind === 'goods') {
    if (normalized.ncm.length !== 8) {
      throw new Error('O NCM deve conter exatamente 8 dígitos.');
    }
    if (normalized.cest && normalized.cest.length !== 7) {
      throw new Error('O CEST deve conter 7 dígitos quando aplicável.');
    }
    if (!normalized.noGtin && !hasValidGtinChecksum(normalized.gtin)) {
      throw new Error('Informe um GTIN/EAN válido ou marque “Sem GTIN”.');
    }
    if (normalized.conversionFactor <= 0 || normalized.conversionFactor > 1_000_000) {
      throw new Error('Informe um fator de conversão tributável válido.');
    }
  } else if (
    !normalized.serviceListCode &&
    !normalized.municipalServiceCode
  ) {
    throw new Error(
      'Informe o item da lista de serviços ou o código municipal do serviço.'
    );
  }

  return {
    ...normalized,
    kind,
    ncm: kind === 'goods' ? normalized.ncm : '',
    cest: kind === 'goods' ? normalized.cest : '',
    gtin: kind === 'goods' && !normalized.noGtin ? normalized.gtin : '',
    noGtin: kind === 'goods' ? normalized.noGtin : true,
    serviceListCode: kind === 'service' ? normalized.serviceListCode : '',
    municipalServiceCode:
      kind === 'service' ? normalized.municipalServiceCode : '',
    nbs: kind === 'service' ? normalized.nbs : '',
    updatedAt: new Date().toISOString(),
  };
};

export const persistProductFiscalProfile = async (
  user: Pick<User, 'uid'>,
  productId: string,
  profile: ProductFiscalProfile | null
): Promise<void> => {
  const normalizedProductId = clean(productId, 128);
  if (!validProductId(normalizedProductId)) {
    throw new Error('O item não foi identificado para os dados fiscais.');
  }

  const reference = doc(db, getProductInventoryDocumentPath(user.uid));

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists() && !profile) return;

    const current = snapshot.data() as Record<string, unknown> | undefined;
    const profiles = parseProductFiscalProfiles(current?.productFiscalProfiles);

    if (profile) profiles[normalizedProductId] = profile;
    else delete profiles[normalizedProductId];

    transaction.set(
      reference,
      {
        ownerId: user.uid,
        inventoryCatalog: Array.isArray(current?.inventoryCatalog)
          ? current.inventoryCatalog
          : [],
        productCompositions:
          current?.productCompositions &&
          typeof current.productCompositions === 'object' &&
          !Array.isArray(current.productCompositions)
            ? current.productCompositions
            : {},
        productFiscalProfiles: profiles,
        updatedAt: serverTimestamp(),
        ...(snapshot.exists() ? {} : { createdAt: serverTimestamp() }),
      },
      { merge: true }
    );
  });
};
