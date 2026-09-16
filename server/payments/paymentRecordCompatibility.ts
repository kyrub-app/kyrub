import {
  normalizeCanonicalPayment,
  type CanonicalPayment,
} from '../../src/utils/canonicalPayment.js';

export type CompatiblePaymentRecord =
  | { kind: 'canonical'; payment: CanonicalPayment }
  | { kind: 'legacy_table_payment_mirror' };

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const validLegacyPaymentMethod = (value: unknown): boolean =>
  value === 'cash' || value === 'pix' || value === 'card' || value === 'other';

export const isLegacyTablePaymentMirror = (
  value: unknown,
  expectedStoreId = ''
): boolean => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const migration = record.migration && typeof record.migration === 'object'
    ? record.migration as Record<string, unknown>
    : null;
  const storeId = clean(record.storeId);
  const explicitType = record.recordType === 'legacy_table_payment_mirror';
  const legacyShape =
    clean(record.legacyStoreId) !== '' &&
    clean(record.tableCode) !== '' &&
    Array.isArray(record.items) &&
    clean(record.actorUserId) !== '' &&
    clean(record.migratedFromPath) !== '' &&
    migration?.mode === 'dual_write';

  if (!explicitType && !legacyShape) return false;
  if (expectedStoreId && storeId !== expectedStoreId) return false;
  if (!storeId || !validLegacyPaymentMethod(record.method)) return false;
  const amount = finite(record.amount);
  const quantity = finite(record.quantity);
  if (amount === null || amount < 0) return false;
  if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) return false;
  return true;
};

export const classifyCompatiblePaymentRecord = (
  value: unknown,
  expectedStoreId: string
): CompatiblePaymentRecord => {
  try {
    const payment = normalizeCanonicalPayment(value as CanonicalPayment);
    if (payment.storeId !== expectedStoreId) {
      throw new Error('PAYMENT_SCOPE_INVALID');
    }
    return { kind: 'canonical', payment };
  } catch (error) {
    if (isLegacyTablePaymentMirror(value, expectedStoreId)) {
      return { kind: 'legacy_table_payment_mirror' };
    }
    throw error;
  }
};
