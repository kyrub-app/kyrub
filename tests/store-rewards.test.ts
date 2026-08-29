import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  STORE_REWARD_SCHEMA_VERSION,
  isStoreRewardAvailableAt,
  normalizeStoreRewardDefinition,
  storeRewardVoucherEndsAt,
  type StoreRewardDefinition,
} from '../shared/storeRewards';
import {
  buildStorePointBonusEntry,
  buildStorePointRedemptionEntry,
  buildStorePointReversalEntry,
  deriveStorePointBalance,
} from '../shared/storePoints';

const reward = (
  patch: Partial<StoreRewardDefinition> = {}
): StoreRewardDefinition => ({
  schemaVersion: STORE_REWARD_SCHEMA_VERSION,
  id: 'reward-10-off',
  storeId: 'store-a',
  title: 'R$ 10 de desconto',
  description: 'Troque pontos por um voucher privado.',
  costPoints: 100,
  discountType: 'fixed',
  discountValue: 10,
  productIds: ['burger'],
  voucherValidityHours: 168,
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-09-30T00:00:00.000Z',
  status: 'active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...patch,
});

describe('store rewards', () => {
  test('normalizes a store-points reward with a scoped checkout benefit', () => {
    const normalized = normalizeStoreRewardDefinition(reward());
    assert.equal(normalized.costPoints, 100);
    assert.equal(normalized.discountType, 'fixed');
    assert.equal(normalized.discountValue, 10);
    assert.deepEqual(normalized.productIds, ['burger']);
  });

  test('rejects invalid percentage rewards and rewards without products', () => {
    assert.throws(
      () => normalizeStoreRewardDefinition(
        reward({ discountType: 'percentage', discountValue: 100 })
      ),
      /STORE_REWARD_DISCOUNT_VALUE_INVALID/
    );
    assert.throws(
      () => normalizeStoreRewardDefinition(reward({ productIds: [] })),
      /STORE_REWARD_PRODUCTS_REQUIRED/
    );
  });

  test('reward availability respects status and configured window', () => {
    assert.equal(
      isStoreRewardAvailableAt(reward(), '2026-08-28T12:00:00.000Z'),
      true
    );
    assert.equal(
      isStoreRewardAvailableAt(
        reward({ status: 'paused' }),
        '2026-08-28T12:00:00.000Z'
      ),
      false
    );
    assert.equal(
      isStoreRewardAvailableAt(reward(), '2026-10-01T00:00:00.000Z'),
      false
    );
  });

  test('voucher validity never extends beyond the reward end date', () => {
    assert.equal(
      storeRewardVoucherEndsAt(
        reward({ voucherValidityHours: 24 }),
        '2026-08-28T12:00:00.000Z'
      ),
      '2026-08-29T12:00:00.000Z'
    );
    assert.equal(
      storeRewardVoucherEndsAt(
        reward({ voucherValidityHours: 720 }),
        '2026-09-29T12:00:00.000Z'
      ),
      '2026-09-30T00:00:00.000Z'
    );
  });

  test('redemption is a real negative ledger movement and not a reversal', () => {
    const earned = buildStorePointBonusEntry({
      bonusId: 'seed-balance',
      storeId: 'store-a',
      customerId: 'customer-a',
      amount: 150,
      reason: 'test_seed',
      correlationId: 'seed-balance',
      occurredAt: '2026-08-28T10:00:00.000Z',
    });
    const redemption = buildStorePointRedemptionEntry({
      redemptionId: 'reward:reward-10-off:customer:customer-a',
      rewardId: 'reward-10-off',
      storeId: 'store-a',
      customerId: 'customer-a',
      costPoints: 100,
      occurredAt: '2026-08-28T12:00:00.000Z',
    });

    assert.equal(redemption.kind, 'redemption');
    assert.equal(redemption.amount, -100);
    assert.equal(redemption.reversalOf, '');
    assert.equal(deriveStorePointBalance([earned, redemption]), 50);
  });

  test('reversing a redemption restores points with a positive compensating movement', () => {
    const redemption = buildStorePointRedemptionEntry({
      redemptionId: 'reward:reward-10-off:customer:customer-a',
      rewardId: 'reward-10-off',
      storeId: 'store-a',
      customerId: 'customer-a',
      costPoints: 100,
      occurredAt: '2026-08-28T12:00:00.000Z',
    });
    const reversal = buildStorePointReversalEntry({
      reversalId: 'cancel-reward-redemption',
      original: redemption,
      reason: 'reward_redemption_cancelled',
      occurredAt: '2026-08-28T12:05:00.000Z',
    });

    assert.equal(reversal.kind, 'reversal');
    assert.equal(reversal.amount, 100);
    assert.equal(reversal.reversalOf, redemption.id);
    assert.equal(deriveStorePointBalance([redemption, reversal]), 0);
  });

  test('server derives balance from the store-points ledger before atomic redemption', () => {
    const service = readFileSync(
      'server/payments/storeRewardService.ts',
      'utf8'
    );

    assert.match(service, /\.where\('customerId', '==', customerId\)/);
    assert.match(service, /deriveStorePointBalance\(entries\)/);
    assert.match(service, /balanceBefore < reward\.costPoints/);
    assert.match(service, /buildStorePointRedemptionEntry/);
    assert.match(service, /transaction\.set\(debitRef, debitEntry\)/);
    assert.match(service, /transaction\.set\(voucherRef, voucher\)/);
    assert.match(service, /transaction\.set\(redemptionRef/);
  });

  test('reward voucher is private to the redeeming user and usable by canonical checkout', () => {
    const rewardService = readFileSync(
      'server/payments/storeRewardService.ts',
      'utf8'
    );
    const promotionService = readFileSync(
      'server/payments/storePromotionService.ts',
      'utf8'
    );

    assert.match(rewardService, /mode: 'specific_user'/);
    assert.match(rewardService, /userIds: \[input\.customerId\]/);
    assert.match(rewardService, /maxRedemptions: 1/);
    assert.match(rewardService, /maxRedemptionsPerBuyer: 1/);
    assert.match(promotionService, /promotion\.eligibility\.mode !== 'specific_user'/);
    assert.match(promotionService, /isPromotionEligibleForBuyer\(promotion, input\.buyerId\)/);
    assert.match(
      promotionService,
      /promotion\.eligibility\.mode !== 'public' \|\|[\s\S]*!isPromotionCurrentlyAvailable/
    );
  });

  test('customer cannot declare identity, balance or point cost in the redemption request', () => {
    const router = readFileSync('server/payments/storeRewardRouter.ts', 'utf8');
    const client = readFileSync('src/utils/storeRewardRedemption.ts', 'utf8');

    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /customerId: identity\.uid/);
    assert.match(client, /JSON\.stringify\(\{ storeId, rewardId \}\)/);
    assert.doesNotMatch(client, /costPoints:/);
    assert.doesNotMatch(client, /balanceBefore:/);
    assert.doesNotMatch(client, /customerId:/);
  });

  test('store reward economy remains separate from K-Coins', () => {
    const contract = readFileSync('shared/storeRewards.ts', 'utf8');
    const service = readFileSync('server/payments/storeRewardService.ts', 'utf8');
    assert.doesNotMatch(contract, /KCoin|K-Coins|kCoin/);
    assert.doesNotMatch(service, /KCoin|K-Coins|kCoin/);
    assert.match(service, /STORE_POINTS_CURRENCY/);
  });
});
