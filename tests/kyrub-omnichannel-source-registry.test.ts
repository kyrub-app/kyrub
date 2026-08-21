import assert from 'node:assert/strict';
import test from 'node:test';
import { KYRUB_SOURCE_CHANNEL_REGISTRY } from '../shared/kyrubOmnichannel';
import {
  buildKyrubOmnichannelIngressEnvelope,
  canonicalKyrubSourceChannel,
} from '../server/integrations/omnichannelIngressEnvelope';

test('core channel registry separates origin from KDS/order behavior', () => {
  assert.equal(KYRUB_SOURCE_CHANNEL_REGISTRY['99food'].external, true);
  assert.ok(KYRUB_SOURCE_CHANNEL_REGISTRY['99food'].capabilities.includes('order_ingress'));
  assert.equal(KYRUB_SOURCE_CHANNEL_REGISTRY.kyrub.external, false);
});

test('source aliases normalize into canonical sourceChannel values', () => {
  assert.equal(canonicalKyrubSourceChannel('99_food'), '99food');
  assert.equal(canonicalKyrubSourceChannel('OpenDelivery'), 'open_delivery');
  assert.equal(canonicalKyrubSourceChannel('customer'), 'kyrub');
  assert.throws(() => canonicalKyrubSourceChannel('mystery'), /OMNICHANNEL_SOURCE_UNKNOWN/);
});

test('same external order produces same ingress idempotency key', () => {
  const first = buildKyrubOmnichannelIngressEnvelope({
    channel: '99food',
    externalOrderId: '99-123',
    tenantId: 'store-1',
    payload: { total: 42 },
    receivedAt: new Date('2026-08-21T20:00:00.000Z'),
  });
  const retry = buildKyrubOmnichannelIngressEnvelope({
    channel: '99food',
    externalOrderId: '99-123',
    tenantId: 'store-1',
    payload: { total: 42 },
    receivedAt: new Date('2026-08-21T20:01:00.000Z'),
  });
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.equal(first.channel, '99food');
});

test('future conversational channels can enter through the same envelope without provider-specific KDS contracts', () => {
  const whatsapp = buildKyrubOmnichannelIngressEnvelope({
    channel: 'whatsapp',
    externalOrderId: 'wa-order-1',
    tenantId: 'store-1',
    payload: { normalized: true },
  });
  assert.equal(whatsapp.channel, 'whatsapp');
  assert.equal(whatsapp.tenantId, 'store-1');
});
