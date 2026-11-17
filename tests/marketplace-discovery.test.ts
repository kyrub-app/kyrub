import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { projectCanonicalOffers, projectLegacyPublicOffers, projectVerifiedFirstStoreCatalogOffers } from '../server/payments/marketplaceDiscoveryService';
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

  test('public storefront restores published tenant fallback without overriding canonical authority', () => {
    const service = readFileSync(
      'server/payments/marketplaceDiscoveryService.ts',
      'utf8'
    );

    assert.match(service, /collection\('marketplace_listings'\)/);
    assert.match(service, /where\('slug', '==', slug\)/);
    assert.match(service, /canonicalStoreDocument/);
    assert.match(service, /storeData\.publicationStatus !== 'published'/);
    assert.match(service, /collection\('tenants'\)/);
    assert.match(service, /data\.publicationStatus === 'published'/);
    assert.match(service, /projectLegacyPublicOffers\(legacyData\.publicProducts, legacyStoreId\)/);
    assert.match(service, /where\('storeId', '==', legacyStoreId\)/);
    assert.match(service, /hasCanonicalStoreAuthority/);
    assert.doesNotMatch(service, /ownerEmail:/);
    assert.doesNotMatch(service, /contact:/);
  });

  test('official plan storefront projects canonical contract terms on both catalog paths', () => {
    const service = readFileSync('server/payments/marketplaceDiscoveryService.ts', 'utf8');
    assert.match(service, /projectOfficialCanonicalTerms\(projectCanonicalOffers/);
    assert.match(service, /projectLegacyPublicOffers\(legacyData\.publicProducts, legacyStoreId\)/);
    assert.match(service, /resolveOfficialStoreProjectionId\(legacyStoreId, offers\)/);
    assert.match(service, /projectOfficialCanonicalTerms\(offers, canonicalId\)/);
    assert.match(service, /projectOfficialCanonicalProductTerms\(offer, canonicalById\.get\(offer\.id\), canonicalStoreId\)/);
    assert.match(service, /OFFICIAL_PLAN_PUBLIC_IDENTITY_CONFLICT/);
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

  test('verified first-store catalog uses the independent ERP store and never exposes drafts', () => {
    const product = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      data: () => ({
        id, storeId: 'store-canonical', publicationStatus: 'published',
        name: 'Produto ' + id, category: 'Produtos', price: 30,
        isService: false, stock: 4, image: 'https://example.invalid/photo.jpg',
        ...overrides,
      }),
    }) as unknown as Parameters<typeof projectVerifiedFirstStoreCatalogOffers>[0][number];

    const offers = projectVerifiedFirstStoreCatalogOffers([
      product('caneta'),
      product('rascunho', { publicationStatus: 'draft' }),
      product('outro-dono', { storeId: 'store-other' }),
      product('sem-preco', { price: undefined }),
      product('sem-estoque', { stock: undefined }),
      product('servico', { isService: true, stock: undefined, price: 90 }),
      product('id-divergente', { id: 'incorrect' }),
    ], 'store-canonical', 'owner-public');

    assert.deepEqual(offers.map(item => item.id), ['caneta', 'servico']);
    assert.deepEqual(offers.map(item => item.price), [30, 90]);
    assert.deepEqual(offers.map(item => item.stock), [4, 0]);
    assert.ok(offers.every(item => item.supplierId === 'owner-public'));
  });

  test('public storefront resolves only verified first-store links; official and legacy paths remain separate', () => {
    const service = readFileSync('server/payments/marketplaceDiscoveryService.ts', 'utf8');
    const publication = readFileSync('server/gamification/firstStorePublicationAuthority.ts', 'utf8');
    assert.match(publication, /listingType: 'store', storeId: uid, ownerId: uid/);
    assert.match(service, /personal\.get\('canonicalStoreId'\)/);
    assert.match(service, /canonicalStore\.get\('firstStoreCreationVerified'\) === true/);
    assert.match(service, /canonicalStore\.get\('ownerId'\) === ownerId/);
    assert.match(service, /canonicalStore\.get\('publicationStatus'\) !== 'published'/);
    assert.match(service, /linkedStoreId !== OFFICIAL_STORE_CANONICAL_ID/);
    assert.match(service, /projectVerifiedFirstStoreCatalogOffers\(canonicalProducts\.docs, verifiedFirstStoreId, storeId\)/);
  });

  test('legacy storefront preserves paid services without physical stock but rejects incomplete products', () => {
    const offers = projectLegacyPublicOffers([
      { id: 'service-no-stock', name: 'Aula individual', price: 80, isService: true, category: 'Educação' },
      { id: 'service-negative-stock', name: 'Consultoria', price: 90, stock: -50, isService: true, category: 'Serviços' },
      { id: 'physical-no-stock', name: 'Caderno', price: 12, isService: false, category: 'Papelaria' },
      { id: 'physical-stock', name: 'Caneta', price: 8, stock: 3, isService: false, category: 'Papelaria' },
      { id: 'service-no-price', name: 'Serviço incompleto', isService: true, category: 'Serviços' },
    ], 'store-legacy');

    assert.deepEqual(offers.map(offer => offer.id), [
      'service-no-stock', 'service-negative-stock', 'physical-stock',
    ]);
    assert.deepEqual(offers.map(offer => offer.stock), [0, 0, 3]);
    assert.ok(offers.every(offer => offer.supplierId === 'store-legacy'));
  });

  test('canonical storefront never publishes a fictitious zero-price offer from incomplete listings', () => {
    const listing = (id: string, overrides: Record<string, unknown> = {}) => ({
      id,
      data: () => ({
        listingType: 'offer',
        publicationStatus: 'published',
        storeId: 'store-a',
        offerId: id,
        productId: id,
        name: 'Item ' + id,
        price: 25,
        stock: 5,
        isService: false,
        ...overrides,
      }),
    }) as unknown as Parameters<typeof projectCanonicalOffers>[0][number];

    const offers = projectCanonicalOffers([
      listing('valid'),
      listing('no-price', { price: undefined }),
      listing('text-price', { price: '25' }),
      listing('negative-price', { price: -1 }),
      listing('no-stock', { stock: undefined }),
      listing('negative-stock', { stock: -2 }),
      listing('wrong-store', { storeId: 'store-b' }),
      listing('draft', { publicationStatus: 'draft' }),
      listing('service', { price: 60, stock: undefined, isService: true }),
    ], 'store-a', new Map());

    assert.deepEqual(offers.map(offer => offer.id), ['valid', 'service']);
    assert.equal(offers[0].price, 25);
    assert.equal(offers[0].stock, 5);
    assert.equal(offers[1].price, 60);
    assert.equal(offers[1].stock, 0);
  });

});