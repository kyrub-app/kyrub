export const KYRUB_SHARED_QUEUE_TOPIC = 'mercado_livre_orders_v2';
export const KYRUB_SHARED_QUEUE_VERSION = 1 as const;

export type KyrubSharedQueueKind =
  | 'mercado_livre_orders_v2'
  | 'marketplace_payment_expiry';

export interface KyrubSharedQueueEnvelope<T = unknown> {
  __kyrubQueueVersion: typeof KYRUB_SHARED_QUEUE_VERSION;
  kind: KyrubSharedQueueKind;
  payload: T;
}

export const createKyrubSharedQueueEnvelope = <T>(
  kind: KyrubSharedQueueKind,
  payload: T
): KyrubSharedQueueEnvelope<T> => ({
  __kyrubQueueVersion: KYRUB_SHARED_QUEUE_VERSION,
  kind,
  payload,
});

export const parseKyrubSharedQueueEnvelope = (
  input: unknown
): KyrubSharedQueueEnvelope | null => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const candidate = input as Record<string, unknown>;
  if (
    candidate.__kyrubQueueVersion !== KYRUB_SHARED_QUEUE_VERSION ||
    (candidate.kind !== 'mercado_livre_orders_v2' &&
      candidate.kind !== 'marketplace_payment_expiry') ||
    !Object.prototype.hasOwnProperty.call(candidate, 'payload')
  ) {
    return null;
  }
  return candidate as unknown as KyrubSharedQueueEnvelope;
};

export const isLegacyMercadoLivreOrdersV2QueuePayload = (input: unknown): boolean => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  return (input as Record<string, unknown>).topic === 'orders_v2';
};
