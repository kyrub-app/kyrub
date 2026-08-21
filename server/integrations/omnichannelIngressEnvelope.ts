import { createHash } from 'node:crypto';
import {
  KYRUB_SOURCE_CHANNEL_REGISTRY,
  type KyrubOmnichannelIngressEnvelope,
  type KyrubSourceChannel,
} from '../../shared/kyrubOmnichannel.js';

const clean = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.trim().slice(0, maximum) : '';

export const buildKyrubOmnichannelIngressEnvelope = <TPayload>(input: {
  channel: KyrubSourceChannel;
  externalOrderId: string;
  tenantId: string;
  payload: TPayload;
  receivedAt?: Date;
}): KyrubOmnichannelIngressEnvelope<TPayload> => {
  const definition = KYRUB_SOURCE_CHANNEL_REGISTRY[input.channel];
  if (!definition.capabilities.includes('order_ingress')) {
    throw new Error(`OMNICHANNEL_ORDER_INGRESS_UNSUPPORTED:${input.channel}`);
  }
  const externalOrderId = clean(input.externalOrderId, 180);
  const tenantId = clean(input.tenantId, 180);
  if (!externalOrderId || !tenantId) {
    throw new Error('OMNICHANNEL_INGRESS_IDENTITY_INVALID');
  }
  const receivedAt = (input.receivedAt ?? new Date()).toISOString();
  const idempotencyKey = `ingress_${createHash('sha256')
    .update(`${input.channel}:${tenantId}:${externalOrderId}`)
    .digest('hex')
    .slice(0, 40)}`;

  return {
    schemaVersion: 1,
    channel: input.channel,
    externalOrderId,
    tenantId,
    receivedAt,
    idempotencyKey,
    payload: input.payload,
  };
};

export const canonicalKyrubSourceChannel = (
  value: string
): KyrubSourceChannel => {
  const normalized = value.trim().toLowerCase();
  if (normalized === '99food' || normalized === '99_food') return '99food';
  if (normalized === 'open_delivery' || normalized === 'opendelivery') return 'open_delivery';
  if (normalized === 'whatsapp') return 'whatsapp';
  if (normalized === 'instagram') return 'instagram';
  if (normalized === 'manual') return 'manual';
  if (normalized === 'kyrub' || normalized === 'customer') return 'kyrub';
  throw new Error(`OMNICHANNEL_SOURCE_UNKNOWN:${normalized}`);
};
