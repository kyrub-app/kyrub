export const LOCAL_PAYMENT_INTENT_MAX_ID_LENGTH = 220;
export const LOCAL_PAYMENT_INTENT_MAX_IDEMPOTENCY_LENGTH = 180;

export interface LocalPaymentIntentCreateInput {
  storeId: string;
  orderId: string;
  idempotencyKey: string;
}

const ALLOWED_FIELDS = new Set(['storeId', 'orderId', 'idempotencyKey']);

const clean = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const validId = (value: string, maximum: number): boolean =>
  Boolean(value) &&
  value.length <= maximum &&
  !value.includes('/') &&
  !value.includes('..');

export const parseLocalPaymentIntentCreateInput = (
  value: unknown
): LocalPaymentIntentCreateInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LOCAL_PAYMENT_INTENT_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some(field => !ALLOWED_FIELDS.has(field))) {
    throw new Error('LOCAL_PAYMENT_INTENT_UNSUPPORTED_FIELD');
  }
  const storeId = clean(candidate.storeId);
  const orderId = clean(candidate.orderId);
  const idempotencyKey = clean(candidate.idempotencyKey);
  if (!validId(storeId, 180) || !validId(orderId, LOCAL_PAYMENT_INTENT_MAX_ID_LENGTH)) {
    throw new Error('LOCAL_PAYMENT_INTENT_SCOPE_REQUIRED');
  }
  if (
    !idempotencyKey ||
    idempotencyKey.length > LOCAL_PAYMENT_INTENT_MAX_IDEMPOTENCY_LENGTH
  ) {
    throw new Error('LOCAL_PAYMENT_INTENT_IDEMPOTENCY_INVALID');
  }
  return { storeId, orderId, idempotencyKey };
};
