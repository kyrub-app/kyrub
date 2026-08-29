import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildMarketplaceStoreDiscoverySignal,
  compareMarketplaceForYouSignals,
  deriveMarketplaceForYouReason,
} from '../shared/marketplaceDiscovery';

describe('marketplace discovery', () => {
  test('promotion and personalization are independent signals', () => {
    const promotionOnly = buildMarketplaceStoreDiscoverySignal({
      storeId: 'promo-store',
      inPromotion: true,
      confirmedPurchases: 0,
      pointsBalance: 0,
    });
    assert.equal(promotionOnly.inPromotion, true);
    assert.equal(promotionOnly.forYou, false);
    assert.equal(promotionOnly.forYouReason, 'none');

    const relationshipOnly = buildMarketplaceStoreDiscoverySignal({
      storeId: 'relationship-store',
      inPromotion: false,
      confirmedPurchases: 2,
      pointsBalance: 30,
    });
    assert.equal(relationshipOnly.inPromotion, false);
    assert.equal(relationshipOnly.forYou, true);
    assert.equal(relationshipOnly.forYouReason, 'purchase_and_points');
  });

  test('for-you reason comes from canonical relationship signals, not public coupon state', () => {
    assert.equal(
      deriveMarketplaceForYouReason({ confirmedPurchases: 1, pointsBalance: 0 }),
      'purchase_history'
    );
    assert.equal(
      deriveMarketplaceForYouReason({ confirmedPurchases: 0, pointsBalance: 10 }),
      'points_balance'
    );
    assert.equal(
      deriveMarketplaceForYouReason({ confirmedPurchases: 0, pointsBalance: 0 }),
      'none'
    );
  });

  test('personalized ranking prioritizes recurrence and then points balance', () => {
    const signals = [
      buildMarketplaceStoreDiscoverySignal({
        storeId: 'points',
        inPromotion: false,
        confirmedPurchases: 1,
        pointsBalance: 100,
      }),
      buildMarketplaceStoreDiscoverySignal({
        storeId: 'recurring',
        inPromotion: false,
        confirmedPurchases: 4,
        pointsBalance: 0,
      }),
      buildMarketplaceStoreDiscoverySignal({
        storeId: 'none',
        inPromotion: true,
        confirmedPurchases: 0,
        pointsBalance: 0,
      }),
    ].sort(compareMarketplaceForYouSignals);

    assert.deepEqual(signals.map(signal => signal.storeId), [
      'recurring',
      'points',
      'none',
    ]);
  });

  test('server owns customer identity and reads canonical payment and points sources', () => {
    const router = readFileSync(
      'server/payments/marketplaceDiscoveryRouter.ts',
      'utf8'
    );
    const service = readFileSync(
      'server/payments/marketplaceDiscoveryService.ts',
      'utf8'
    );
    const client = readFileSync('src/utils/marketplaceDiscovery.ts', 'utf8');

    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /customerId: identity\.uid/);
    assert.match(service, /collection\(paymentCollectionPath\(input\.storeId\)\)/);
    assert.match(service, /where\('buyerId', '==', input\.customerId\)/);
    assert.match(service, /collection\(ledgerCollectionPath\(input\.storeId\)\)/);
    assert.match(service, /where\('customerId', '==', input\.customerId\)/);
    assert.match(service, /listPublicStorePromotions\(input\.storeId, input\.now\)/);
    assert.match(client, /body: JSON\.stringify\(\{ storeIds \}\)/);
    assert.doesNotMatch(
      client,
      /body: JSON\.stringify\(\{[^}]*customerId[^}]*\}\)/
    );
  });

  test('marketplace UI exposes promotion and for-you as separate filters', () => {
    const source = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
    assert.match(source, />\s*Em promoção\s*</);
    assert.match(source, /'promotion'/);
    assert.match(source, /'for_you'/);
    assert.match(source, /signalByStoreId\.get\(store\.id\)\?\.inPromotion/);
    assert.match(source, /signalByStoreId\.get\(store\.id\)\?\.forYou/);
    assert.doesNotMatch(source, /orders\.some\(order => order\.storeId/);
  });
});
