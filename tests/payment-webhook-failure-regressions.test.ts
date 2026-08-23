import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canTransitionPaymentStatus,
  isPaymentAuthoritativelyPaid,
} from '../src/utils/canonicalPayment';
import {
  buildPaymentWebhookIdempotencyKey,
  type VerifiedPaymentProviderEvent,
} from '../src/utils/paymentProvider';

const event = (eventId: string): VerifiedPaymentProviderEvent => ({
  provider: 'mercado_pago',
  eventId,
  eventType: 'payment.expired',
  providerPaymentId: 'provider-payment-1',
  paymentIntentId: 'intent-1',
  amount: 29.5,
  currency: 'BRL',
  method: 'pix',
  occurredAt: '2026-08-23T03:00:00.000Z',
  signatureVerified: true,
});

test('webhook replay uses deterministic provider/event idempotency identity', () => {
  assert.equal(buildPaymentWebhookIdempotencyKey(event('evt-1')), 'mercado_pago|evt-1');
  assert.equal(
    buildPaymentWebhookIdempotencyKey(event('evt-1')),
    buildPaymentWebhookIdempotencyKey(event('evt-1'))
  );
});

test('out-of-order terminal events cannot resurrect failed or expired payments as paid', () => {
  assert.equal(canTransitionPaymentStatus('expired', 'paid'), false);
  assert.equal(canTransitionPaymentStatus('failed', 'paid'), false);
  assert.equal(isPaymentAuthoritativelyPaid('expired'), false);
  assert.equal(isPaymentAuthoritativelyPaid('failed'), false);
});

test('webhook processor persists idempotency before authoritative state changes and does not trust frontend paid state', () => {
  const source = readFileSync('server/payments/paymentWebhookProcessor.ts', 'utf8');
  assert.match(source, /buildPaymentWebhookIdempotencyKey\(event\)/);
  assert.match(source, /const duplicate = eventSnapshot\.exists/);
  assert.match(source, /if \(!duplicate\)/);
  assert.match(source, /assertPaymentStatusTransition\(current\.status, requestedStatus\)/);
  assert.match(source, /paymentStatusFromProviderEvent\(event\.eventType\)/);
  assert.doesNotMatch(source, /frontend.*paid|client.*paid|request\.body\.paid/i);
});

test('unknown provider response cannot map itself to paid because event type is closed', () => {
  const source = readFileSync('src/utils/paymentProvider.ts', 'utf8');
  assert.match(source, /export type PaymentProviderEventType =/);
  assert.doesNotMatch(source, /\| string/);
  assert.match(source, /case 'payment\.paid'/);
  assert.match(source, /case 'payment\.failed'/);
  assert.match(source, /case 'payment\.expired'/);
});
