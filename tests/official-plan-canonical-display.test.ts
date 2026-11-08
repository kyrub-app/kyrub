import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  OFFICIAL_STORE_CANONICAL_ID,
  projectOfficialCanonicalProductTerms,
} from '../shared/officialPlanCanonicalDisplay.js';
import { buildSubscriptionSaleModality } from '../shared/productSaleModality.js';

const discounts = [
  { months: 1 as const, discountPercent: 0 },
  { months: 3 as const, discountPercent: 20 },
  { months: 6 as const, discountPercent: 30 },
  { months: 12 as const, discountPercent: 40 },
];

test('both official plans project canonical description, manual renewal and discounts', () => {
  for (const [id, price] of [
    ['draft_1d3dfa74091747d3a3012eadd8027894', 197],
    ['draft_5f46706373714839a55846e6d8cb102c', 397],
  ] as const) {
    const legacy = {
      id,
      price,
      description: 'Assinatura mensal com renovação automática e acesso contínuo.',
      saleModality: buildSubscriptionSaleModality({
        billingUnit: 'month', benefitKind: 'access', autoRenew: true,
      }),
      contractDiscounts: undefined as { months: 1 | 3 | 6 | 12; discountPercent: number }[] | undefined,
      supplierId: 'tenant-owner',
      image: 'unchanged-image',
    };
    const canonical = {
      id,
      storeId: OFFICIAL_STORE_CANONICAL_ID,
      publicationStatus: 'published',
      price,
      description: 'Plano pré-pago via Pix, sem renovação automática; novo aceite e novo pagamento.',
      saleModality: buildSubscriptionSaleModality({
        billingUnit: 'month', benefitKind: 'access', autoRenew: false,
      }),
      contractDiscounts: discounts,
    };
    const result = projectOfficialCanonicalProductTerms(legacy, canonical, OFFICIAL_STORE_CANONICAL_ID);
    assert.equal(result.description, canonical.description);
    assert.equal(result.saleModality?.subscription?.autoRenew, false);
    assert.deepEqual(result.contractDiscounts, discounts);
    assert.equal(result.price, price);
    assert.equal(result.supplierId, legacy.supplierId);
    assert.equal(result.image, legacy.image);
    assert.equal(legacy.saleModality.subscription?.autoRenew, true);
  }
});

test('projection fails closed on missing, unpublished, wrong price or different store', () => {
  const id = 'draft_1d3dfa74091747d3a3012eadd8027894';
  const offer = { id, price: 197, description: 'legacy' };
  const canonical = {
    id,
    price: 197,
    description: 'canonical',
    storeId: OFFICIAL_STORE_CANONICAL_ID,
    publicationStatus: 'published',
    saleModality: buildSubscriptionSaleModality({
      billingUnit: 'month', benefitKind: 'access', autoRenew: false,
    }),
  };
  const project = (value: unknown, storeId = OFFICIAL_STORE_CANONICAL_ID) =>
    projectOfficialCanonicalProductTerms(offer, value, storeId);
  assert.throws(() => project(undefined), /OFFICIAL_PLAN_CANONICAL_TERMS_CONFLICT/);
  assert.throws(() => project({ ...canonical, price: 200 }), /OFFICIAL_PLAN_CANONICAL_TERMS_CONFLICT/);
  assert.throws(() => project({ ...canonical, publicationStatus: 'draft' }), /OFFICIAL_PLAN_CANONICAL_TERMS_CONFLICT/);
  assert.throws(() => project({ ...canonical, storeId: 'other' }), /OFFICIAL_PLAN_CANONICAL_TERMS_CONFLICT/);
  assert.throws(() => project(canonical, 'other'), /OFFICIAL_PLAN_CANONICAL_TERMS_CONFLICT/);
  assert.throws(() => project({ ...canonical, saleModality: { mode: 'one_time', schemaVersion: 1, subscription: null } }), /OFFICIAL_PLAN_CANONICAL_TERMS_CONFLICT/);
});

test('public legacy storefront verifies official designation before canonical projection', () => {
  const source = readFileSync('server/payments/marketplaceDiscoveryService.ts', 'utf8');
  assert.match(source, /adminDb\.doc\('kyrub_admin\/official_store'\)\.get\(\)/);
  assert.match(source, /clean\(data\.legacyStoreId\) !== legacyStoreId/);
  assert.match(source, /resolveOfficialStoreProjectionId\(legacyStoreId, offers\)/);
  assert.match(source, /projectOfficialCanonicalTerms\(offers, canonicalId\)/);
});

test('ERP reads canonical product terms and prevents legacy editor from writing them', () => {
  const source = readFileSync('src/components/store/ProductInventoryDirectRuntime.tsx', 'utf8');
  assert.match(source, /doc\(db, 'stores', OFFICIAL_STORE_CANONICAL_ID, 'products', product\.id\)/);
  assert.match(source, /projectOfficialCanonicalProductTerms\(product, record, OFFICIAL_STORE_CANONICAL_ID\)/);
  assert.match(source, /if \(await isOfficialPlanForStore\(activeRetailerId, product\.id\)\)/);
  assert.match(source, /const displayProducts = useMemo/);
  assert.match(source, /return resolved \? \[resolved\] : \[\]/);
});
