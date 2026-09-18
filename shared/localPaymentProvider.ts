export interface LocalPixProviderAttachInput {
  storeId: string;
  paymentIntentId: string;
  paymentId: string;
}

const ALLOWED_FIELDS = new Set(['storeId', 'paymentIntentId', 'paymentId']);

const cleanId = (value: unknown, max: number): string => {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id || id.length > max || id.includes('/') || id.includes('..')) {
    throw new Error('LOCAL_PIX_PROVIDER_TARGET_INVALID');
  }
  return id;
};

export const parseLocalPixProviderAttachInput = (
  value: unknown
): LocalPixProviderAttachInput => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LOCAL_PIX_PROVIDER_INVALID');
  }
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some(field => !ALLOWED_FIELDS.has(field))) {
    throw new Error('LOCAL_PIX_PROVIDER_UNSUPPORTED_FIELD');
  }
  return {
    storeId: cleanId(candidate.storeId, 180),
    paymentIntentId: cleanId(candidate.paymentIntentId, 220),
    paymentId: cleanId(candidate.paymentId, 220),
  };
};
