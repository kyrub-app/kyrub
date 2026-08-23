import assert from 'node:assert/strict';
import test from 'node:test';
import { buildKyrubRedemptionPlan } from '../shared/gamificationRedemption';

const reward = {
  id: 'reward-1',
  title: 'Voucher Loja X',
  description: 'Benefício de teste',
  costKCoins: 100,
  fundingType: 'store' as const,
  storeId: 'store-1',
  benefit: { type: 'voucher' as const, voucherTemplateId: 'voucher-template-1' },
};

test('redemption plan produces stable identities for atomic persistence', () => {
  const input = {
    userId: 'user-1',
    reward,
    currentBalanceKCoins: 500,
    idempotencyKey: 'idem-1',
    correlationId: 'corr-1',
    occurredAt: '2026-08-23T12:00:00.000Z',
    validUntil: '2026-09-23T12:00:00.000Z',
  };
  const first = buildKyrubRedemptionPlan(input);
  const second = buildKyrubRedemptionPlan(input);
  assert.equal(first.redemptionId, second.redemptionId);
  assert.equal(first.debitEntry.id, second.debitEntry.id);
  assert.equal(first.voucherCode, second.voucherCode);
  assert.equal(first.auditEvent.idempotencyKey, second.auditEvent.idempotencyKey);
});

test('redemption plan refuses overdraft before persistence', () => {
  assert.throws(() => buildKyrubRedemptionPlan({
    userId: 'user-1', reward, currentBalanceKCoins: 99,
    idempotencyKey: 'idem-2', correlationId: 'corr-2',
    occurredAt: '2026-08-23T12:00:00.000Z', validUntil: '2026-09-23T12:00:00.000Z',
  }), /REDEMPTION_INSUFFICIENT_KCOINS/);
});
