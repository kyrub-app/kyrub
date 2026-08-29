import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  deriveStoreRelationshipLevel,
  relationshipProgressPercent,
} from '../shared/storeRelationship';

describe('customer store relationship', () => {
  test('relationship level is derived from confirmed purchase recurrence, not money spent', () => {
    assert.deepEqual(
      deriveStoreRelationshipLevel(0),
      {
        key: 'first_contact',
        label: 'Primeiro contato',
        confirmedPurchases: 0,
        nextLabel: 'Cliente',
        nextAtPurchases: 1,
        progressPercent: 0,
      }
    );
    assert.equal(deriveStoreRelationshipLevel(1).key, 'customer');
    assert.equal(deriveStoreRelationshipLevel(3).key, 'recurring');
    assert.equal(deriveStoreRelationshipLevel(10).key, 'frequent');
    assert.equal(deriveStoreRelationshipLevel(25).key, 'loyal');
    assert.equal(deriveStoreRelationshipLevel(999).progressPercent, 100);
  });

  test('challenge progress percentage is bounded and integer deterministic', () => {
    assert.equal(relationshipProgressPercent(0, 3), 0);
    assert.equal(relationshipProgressPercent(1, 3), 33);
    assert.equal(relationshipProgressPercent(3, 3), 100);
    assert.equal(relationshipProgressPercent(7, 3), 100);
    assert.throws(
      () => relationshipProgressPercent(1, 0),
      /STORE_RELATIONSHIP_TARGET_INVALID/
    );
  });

  test('relationship balance comes from points ledger while level comes from canonical payments', () => {
    const source = readFileSync(
      'server/payments/storeRelationshipService.ts',
      'utf8'
    );

    assert.match(source, /storePointLedger/);
    assert.match(source, /deriveStorePointBalance\(entries\)/);
    assert.match(source, /paymentCollectionPath/);
    assert.match(source, /\.where\('buyerId', '==', customerId\)/);
    assert.match(source, /isPaymentAuthoritativelyPaid\(payment\.status\)/);
    assert.match(source, /deriveStoreRelationshipLevel\(confirmedPurchases\)/);
    assert.doesNotMatch(source, /pointsPerReal|pontosPorReal|points_per_real/i);
    assert.doesNotMatch(source, /orderDraft\.total|paidTotalMinor/);
  });

  test('zero-point purchases still count for relationship level because payments are authoritative', () => {
    const source = readFileSync(
      'server/payments/storeRelationshipService.ts',
      'utf8'
    );

    assert.match(source, /countConfirmedPurchases/);
    assert.match(source, /paymentSnapshot\.docs/);
    assert.doesNotMatch(source, /confirmedPurchases = entries\.filter/);
  });

  test('relationship projection includes challenges, rewards, vouchers, coupons and ledger history', () => {
    const source = readFileSync(
      'server/payments/storeRelationshipService.ts',
      'utf8'
    );

    assert.match(source, /challengeProgress/);
    assert.match(source, /storeChallenges/);
    assert.match(source, /rewardRedemptions/);
    assert.match(source, /storeRewards/);
    assert.match(source, /listPublicStorePromotions/);
    assert.match(source, /voucherPromotionId/);
    assert.match(source, /historyItem/);
  });

  test('authenticated relationship endpoint always scopes the customer to Firebase identity', () => {
    const router = readFileSync(
      'server/payments/storeRelationshipRouter.ts',
      'utf8'
    );
    const client = readFileSync('src/utils/storeRelationship.ts', 'utf8');

    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /customerId: identity\.uid/);
    assert.match(client, /authorization: `Bearer \$\{idToken\}`/);
    assert.doesNotMatch(client, /customerId=/);
    assert.doesNotMatch(client, /customerId:/);
  });

  test('storefront relationship panel consumes server truth and refreshes after reward redemption', () => {
    const panel = readFileSync(
      'src/components/CustomerStoreRelationshipPanel.tsx',
      'utf8'
    );
    const storefront = readFileSync('src/components/StorefrontPanel.tsx', 'utf8');

    assert.match(panel, /loadStoreRelationshipForCurrentUser\(storeId\)/);
    assert.match(panel, /redeemStoreRewardForCurrentUser/);
    assert.match(panel, /await refresh\(\)/);
    assert.match(panel, /summary\.points\.balance/);
    assert.match(panel, /summary\.level\.label/);
    assert.match(panel, /summary\.challenges/);
    assert.match(panel, /summary\.rewards/);
    assert.match(panel, /summary\.vouchers/);
    assert.match(panel, /summary\.coupons/);
    assert.match(panel, /summary\.history/);
    assert.match(storefront, /CustomerStoreRelationshipPanel/);
  });

  test('store relationship economy remains independent from K-Coins', () => {
    const contract = readFileSync('shared/storeRelationship.ts', 'utf8');
    const service = readFileSync(
      'server/payments/storeRelationshipService.ts',
      'utf8'
    );
    assert.doesNotMatch(contract, /KCoin|K-Coins|kCoin/);
    assert.doesNotMatch(service, /KCoin|K-Coins|kCoin/);
  });
});