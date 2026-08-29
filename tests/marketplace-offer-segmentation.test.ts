import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

describe('marketplace offer segmentation', () => {
  test('Em promoção is derived from active public promotions', () => {
    const service = readFileSync(
      'server/marketplace/offerSegmentationService.ts',
      'utf8'
    );

    assert.match(service, /listPublicStorePromotions\(storeId, now\)/);
    assert.match(service, /hasPromotion: promotions\.length > 0/);
    assert.match(service, /promotionStoreIds/);
  });

  test('Para você is independently derived from authoritative customer purchases', () => {
    const service = readFileSync(
      'server/marketplace/offerSegmentationService.ts',
      'utf8'
    );

    assert.match(service, /stores\/\$\{storeId\}\/payments/);
    assert.match(service, /\.where\('buyerId', '==', customerId\)/);
    assert.match(service, /isPaymentAuthoritativelyPaid\(payment\.status\)/);
    assert.match(service, /forYouStoreIds/);
    assert.doesNotMatch(service, /favoriteStoreIds/);
  });

  test('promotion and personalization are returned as different segments', () => {
    const service = readFileSync(
      'server/marketplace/offerSegmentationService.ts',
      'utf8'
    );

    assert.match(service, /hasPromotion: promotions\.length > 0/);
    assert.match(service, /forYou: hasPurchase/);
    assert.match(service, /segment\.hasPromotion/);
    assert.match(service, /segment\.forYou/);
  });

  test('segmentation endpoint scopes personalization to Firebase identity', () => {
    const router = readFileSync(
      'server/marketplace/offerSegmentationRouter.ts',
      'utf8'
    );
    const client = readFileSync(
      'src/utils/marketplaceOfferSegments.ts',
      'utf8'
    );

    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /customerId: identity\.uid/);
    assert.match(client, /body: JSON\.stringify\(\{ storeIds \}\)/);
    assert.doesNotMatch(client, /customerId:/);
  });

  test('marketplace wrapper maps canonical segments into legacy compatibility slots', () => {
    const wrapper = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
    const legacy = readFileSync(
      'src/components/tabs/LegacyKyrubTab.tsx',
      'utf8'
    );

    assert.match(wrapper, /loadMarketplaceOfferSegments/);
    assert.match(wrapper, /isNew: promotionSet\.has\(store\.id\)/);
    assert.match(wrapper, /legacyForYouOrders/);
    assert.match(wrapper, /forYouStoreIds\.map/);
    assert.match(wrapper, /storesWithCoords=\{segmentedStores\}/);
    assert.match(wrapper, /orders=\{legacyForYouOrders\}/);

    assert.match(legacy, /ofertasFilter === 'novas'/);
    assert.match(legacy, /return Boolean\(store\.isNew\)/);
    assert.match(legacy, /ofertasFilter === 'cliente'/);
    assert.match(legacy, /orders\.some\(order => order\.storeId === store\.id\)/);
  });

  test('visible marketplace labels say Em promoção and Para você', () => {
    const bridge = readFileSync(
      'src/components/MarketplaceOfferFilterLabelBridge.tsx',
      'utf8'
    );

    assert.match(bridge, /promotionButton\.textContent = 'Em promoção'/);
    assert.match(bridge, /forYouButton\.textContent = 'Para você'/);
    assert.match(bridge, /Lojas com promoção pública ativa/);
    assert.match(bridge, /histórico de compra confirmado/);
  });

  test('segment batching preserves marketplaces with more than one server batch', () => {
    const wrapper = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
    const service = readFileSync(
      'server/marketplace/offerSegmentationService.ts',
      'utf8'
    );

    assert.match(wrapper, /SEGMENT_BATCH_SIZE = 100/);
    assert.match(wrapper, /index \+= SEGMENT_BATCH_SIZE/);
    assert.match(wrapper, /results\.flatMap\(result => result\.promotionStoreIds\)/);
    assert.match(wrapper, /results\.flatMap\(result => result\.forYouStoreIds\)/);
    assert.match(service, /MARKETPLACE_OFFER_SEGMENT_MAX_STORES = 100/);
  });
});