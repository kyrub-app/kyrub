import { FieldValue } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import {
  getBrazilFiscalTaxIdentifierKind,
  isValidBrazilFiscalTaxIdentifier,
  normalizeBrazilFiscalTaxIdentifier,
} from '../../src/utils/brazilFiscalIdentifier.js';
import { resolveInPersonOrderStoreContext } from './inPersonOrderService.js';

const ORDER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,240}$/;
const MAX_ORDER_IDS = 20;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const digits = (value: unknown, maxLength: number): string =>
  clean(value, maxLength * 2).replace(/\D/g, '').slice(0, maxLength);

const normalizeOrderIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) throw new Error('FISCAL_CONSUMER_ORDER_IDS_REQUIRED');
  const result = Array.from(new Set(value.map(item => clean(item)).filter(Boolean)));
  if (result.length === 0 || result.length > MAX_ORDER_IDS) {
    throw new Error('FISCAL_CONSUMER_ORDER_IDS_INVALID');
  }
  if (result.some(orderId => !ORDER_ID_PATTERN.test(orderId))) {
    throw new Error('FISCAL_CONSUMER_ORDER_IDS_INVALID');
  }
  return result;
};

const maskTaxIdentifier = (normalized: string): string => {
  const suffix = normalized.slice(-4);
  return `${'•'.repeat(Math.max(0, normalized.length - suffix.length))}${suffix}`;
};

export interface FiscalRecipientAddress {
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface FiscalRecipientProfile {
  name: string;
  stateRegistration: string;
  email: string;
  phone: string;
  address: FiscalRecipientAddress;
}

export interface FiscalConsumerIdentitySummary {
  status: 'identified';
  identifierKind: 'cpf' | 'cnpj';
  maskedTaxIdentifier: string;
  recipientProfileStatus: 'not_captured' | 'complete_for_nfe';
  capturedAt: string;
}

export interface FiscalConsumerIdentitySelectionResult {
  status: 'none' | 'uniform' | 'mixed';
  orderIds: string[];
  identity: FiscalConsumerIdentitySummary | null;
}

interface StoredFiscalConsumerIdentity {
  taxIdentifier: string;
  identifierKind: 'cpf' | 'cnpj';
  capturedAt: string;
  recipientProfile: FiscalRecipientProfile | null;
  recipientProfileFingerprint: string | null;
}

const normalizeRecipientProfile = (value: unknown): FiscalRecipientProfile | null => {
  if (value === undefined || value === null) return null;
  const raw = record(value);
  if (Object.keys(raw).length === 0) return null;
  const address = record(raw.address);
  const profile: FiscalRecipientProfile = {
    name: clean(raw.name, 120),
    stateRegistration: clean(raw.stateRegistration, 30),
    email: clean(raw.email, 160).toLowerCase(),
    phone: digits(raw.phone, 12),
    address: {
      street: clean(address.street, 120),
      number: clean(address.number, 20),
      complement: clean(address.complement, 60),
      district: clean(address.district, 80),
      city: clean(address.city, 80),
      state: clean(address.state, 2).toUpperCase(),
      postalCode: digits(address.postalCode, 8),
      country: clean(address.country, 60),
    },
  };
  if (
    !profile.name ||
    !profile.address.street ||
    !profile.address.number ||
    !profile.address.district ||
    !profile.address.city ||
    !/^[A-Z]{2}$/.test(profile.address.state) ||
    !/^\d{8}$/.test(profile.address.postalCode) ||
    !profile.address.country ||
    (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) ||
    (profile.phone && !/^\d{7,12}$/.test(profile.phone))
  ) {
    throw new Error('FISCAL_CONSUMER_RECIPIENT_PROFILE_INVALID');
  }
  return profile;
};

const recipientProfileFingerprint = (profile: FiscalRecipientProfile | null): string | null =>
  profile
    ? createHash('sha256').update(JSON.stringify(profile)).digest('hex')
    : null;

const parseStoredIdentity = (value: unknown): StoredFiscalConsumerIdentity | null => {
  if (value === undefined || value === null) return null;
  const raw = record(value);
  if (Object.keys(raw).length === 0) return null;
  const taxIdentifier = normalizeBrazilFiscalTaxIdentifier(clean(raw.taxIdentifier, 32));
  const identifierKind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
  const capturedAt = clean(raw.capturedAt, 64);
  if (
    (raw.schemaVersion !== 1 && raw.schemaVersion !== 2) ||
    raw.status !== 'identified' ||
    raw.source !== 'staff_checkout' ||
    (identifierKind !== 'cpf' && identifierKind !== 'cnpj') ||
    raw.identifierKind !== identifierKind ||
    !isValidBrazilFiscalTaxIdentifier(taxIdentifier) ||
    !capturedAt ||
    !Number.isFinite(Date.parse(capturedAt))
  ) {
    throw new Error('FISCAL_CONSUMER_IDENTITY_STORED_INVALID');
  }
  const recipientProfile = raw.schemaVersion === 2
    ? normalizeRecipientProfile(raw.recipientProfile)
    : null;
  return {
    taxIdentifier,
    identifierKind,
    capturedAt,
    recipientProfile,
    recipientProfileFingerprint: recipientProfileFingerprint(recipientProfile),
  };
};

const assertOwnerScope = async (input: {
  legacyStoreId: string;
  requestedByUserId: string;
}) => {
  const legacyStoreId = clean(input.legacyStoreId, 160);
  const requestedByUserId = clean(input.requestedByUserId, 160);
  if (!legacyStoreId || legacyStoreId !== requestedByUserId) {
    throw new Error('FISCAL_CONSUMER_IDENTITY_FORBIDDEN');
  }
  return resolveInPersonOrderStoreContext(legacyStoreId);
};

const readSelection = async (input: {
  canonicalStoreId: string;
  orderIds: string[];
}): Promise<FiscalConsumerIdentitySelectionResult> => {
  const refs = input.orderIds.map(orderId =>
    adminDb.doc(`stores/${input.canonicalStoreId}/orders/${orderId}`)
  );
  const snapshots = refs.length ? await adminDb.getAll(...refs) : [];
  const identities = snapshots.map((snapshot, index) => {
    if (!snapshot.exists) throw new Error('FISCAL_CONSUMER_ORDER_NOT_FOUND');
    const order = record(snapshot.data());
    const persistedOrderId = clean(order.id);
    const persistedStoreId = clean(order.storeId, 160);
    if (
      (persistedOrderId && persistedOrderId !== input.orderIds[index]) ||
      (persistedStoreId && persistedStoreId !== input.canonicalStoreId)
    ) {
      throw new Error('FISCAL_CONSUMER_ORDER_INTEGRITY_INVALID');
    }
    return parseStoredIdentity(order.fiscalConsumerIdentity);
  });

  const identified = identities.filter(
    (identity): identity is StoredFiscalConsumerIdentity => Boolean(identity)
  );
  if (identified.length === 0) {
    return { status: 'none', orderIds: input.orderIds, identity: null };
  }
  const first = identified[0];
  const uniform = identified.length === identities.length &&
    identified.every(identity =>
      identity.taxIdentifier === first.taxIdentifier &&
      identity.recipientProfileFingerprint === first.recipientProfileFingerprint
    );
  if (!uniform) {
    return { status: 'mixed', orderIds: input.orderIds, identity: null };
  }
  return {
    status: 'uniform',
    orderIds: input.orderIds,
    identity: {
      status: 'identified',
      identifierKind: first.identifierKind,
      maskedTaxIdentifier: maskTaxIdentifier(first.taxIdentifier),
      recipientProfileStatus: first.recipientProfile ? 'complete_for_nfe' : 'not_captured',
      capturedAt: first.capturedAt,
    },
  };
};

export const loadFiscalConsumerIdentitySelection = async (input: {
  legacyStoreId: string;
  requestedByUserId: string;
  orderIds: unknown;
}): Promise<FiscalConsumerIdentitySelectionResult> => {
  const orderIds = normalizeOrderIds(input.orderIds);
  const context = await assertOwnerScope(input);
  return readSelection({ canonicalStoreId: context.canonicalStoreId, orderIds });
};

export const saveFiscalConsumerIdentitySelection = async (input: {
  legacyStoreId: string;
  requestedByUserId: string;
  orderIds: unknown;
  taxIdentifier: unknown;
  recipientProfile?: unknown;
  now?: Date;
}): Promise<FiscalConsumerIdentitySelectionResult> => {
  const orderIds = normalizeOrderIds(input.orderIds);
  const context = await assertOwnerScope(input);
  const taxIdentifier = normalizeBrazilFiscalTaxIdentifier(clean(input.taxIdentifier, 32));
  const identifierKind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
  if (
    (identifierKind !== 'cpf' && identifierKind !== 'cnpj') ||
    !isValidBrazilFiscalTaxIdentifier(taxIdentifier)
  ) {
    throw new Error('FISCAL_CONSUMER_TAX_IDENTIFIER_INVALID');
  }
  const profileProvided = input.recipientProfile !== undefined && input.recipientProfile !== null;
  const recipientProfile = profileProvided
    ? normalizeRecipientProfile(input.recipientProfile)
    : null;
  if (profileProvided && !recipientProfile) {
    throw new Error('FISCAL_CONSUMER_RECIPIENT_PROFILE_INVALID');
  }
  const capturedAt = (input.now ?? new Date()).toISOString();
  if (!Number.isFinite(Date.parse(capturedAt))) {
    throw new Error('FISCAL_CONSUMER_CAPTURE_TIME_INVALID');
  }

  const refs = orderIds.map(orderId =>
    adminDb.doc(`stores/${context.canonicalStoreId}/orders/${orderId}`)
  );
  await adminDb.runTransaction(async transaction => {
    const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) throw new Error('FISCAL_CONSUMER_ORDER_NOT_FOUND');
      const order = record(snapshot.data());
      const persistedOrderId = clean(order.id);
      const persistedStoreId = clean(order.storeId, 160);
      if (
        (persistedOrderId && persistedOrderId !== orderIds[index]) ||
        (persistedStoreId && persistedStoreId !== context.canonicalStoreId)
      ) {
        throw new Error('FISCAL_CONSUMER_ORDER_INTEGRITY_INVALID');
      }
    });

    refs.forEach(ref => {
      transaction.set(ref, {
        fiscalConsumerIdentity: {
          schemaVersion: recipientProfile ? 2 : 1,
          status: 'identified',
          taxIdentifier,
          identifierKind,
          ...(recipientProfile ? { recipientProfile } : {}),
          source: 'staff_checkout',
          capturedByUserId: input.requestedByUserId,
          capturedAt,
        },
        fiscalConsumerIdentityUpdatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    });
  });

  return {
    status: 'uniform',
    orderIds,
    identity: {
      status: 'identified',
      identifierKind,
      maskedTaxIdentifier: maskTaxIdentifier(taxIdentifier),
      recipientProfileStatus: recipientProfile ? 'complete_for_nfe' : 'not_captured',
      capturedAt,
    },
  };
};
