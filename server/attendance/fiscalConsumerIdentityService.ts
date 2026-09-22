import { FieldValue } from 'firebase-admin/firestore';
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

export interface FiscalConsumerIdentitySummary {
  status: 'identified';
  identifierKind: 'cpf' | 'cnpj';
  maskedTaxIdentifier: string;
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
}

const parseStoredIdentity = (value: unknown): StoredFiscalConsumerIdentity | null => {
  if (value === undefined || value === null) return null;
  const raw = record(value);
  if (Object.keys(raw).length === 0) return null;
  const taxIdentifier = normalizeBrazilFiscalTaxIdentifier(clean(raw.taxIdentifier, 32));
  const identifierKind = getBrazilFiscalTaxIdentifierKind(taxIdentifier);
  const capturedAt = clean(raw.capturedAt, 64);
  if (
    raw.schemaVersion !== 1 ||
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
  return { taxIdentifier, identifierKind, capturedAt };
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
    identified.every(identity => identity.taxIdentifier === first.taxIdentifier);
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
          schemaVersion: 1,
          status: 'identified',
          taxIdentifier,
          identifierKind,
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
      capturedAt,
    },
  };
};
