import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('../server/admin/officialPlanProductLookup.ts', import.meta.url), 'utf8');
describe('official plan product lookup boundaries', () => {
  it('reads a persisted product from the canonical store instead of trusting a cart plan tag', () => {
    assert.match(source, /stores\/\$\{seller\.canonicalStoreId\}\/products\/\$\{productId\}/);
    assert.match(source, /official_plan_products/);
    assert.match(source, /mappingData\.planId/);
    assert.doesNotMatch(source, /input\.platformPlanId/);
  });
  it('rejects fixed-term offers before monthly platform checkout can ignore their discounts', () => {
    assert.match(source, /data\.contractDiscounts !== undefined/);
    assert.match(source, /OFFICIAL_PLAN_CONTRACT_CHECKOUT_REQUIRED/);
    assert.ok(source.indexOf('OFFICIAL_PLAN_CONTRACT_CHECKOUT_REQUIRED') < source.indexOf('const productPrice = data.price'));
  });
  it('checks subscription modality and official store identity before platform routing', () => {
    assert.match(source, /parseProductSaleModality/);
    assert.match(source, /getOfficialStoreIdentity/);
    assert.match(source, /resolveCheckoutBillingRoute/);
    assert.match(source, /UNTRUSTED_PRODUCT_PLAN_TAG/);
    assert.match(source, /INVALID_PLATFORM_PLAN_MAPPING/);
  });
});


describe('official plan product management gateway', () => {
  it('exposes the admin-only mapping operation without a new serverless function', () => {
    const gateway = readFileSync(new URL('../api/plan-control.ts', import.meta.url), 'utf8');
    const management = readFileSync(new URL('../server/admin/officialPlanProductManagement.ts', import.meta.url), 'utf8');
    assert.match(gateway, /case 'admin\.official-plan-product\.assign'/);
    assert.match(gateway, /await assignOfficialPlanProduct\(/);
    assert.match(management, /admin\.role !== 'super_admin'/);
    assert.match(management, /transaction\.get\(productRef\)/);
    assert.match(management, /transaction\.set\(mappingRef/);
  });
});


it('official plan contract offers cannot silently fall back to monthly-only checkout', () => {
  const source = readFileSync('server/admin/officialPlanProductLookup.ts', 'utf8');
  assert.match(source, /planId !== null && data\.contractDiscounts !== undefined/);
  assert.match(source, /OFFICIAL_PLAN_CONTRACT_CHECKOUT_REQUIRED/);
});


describe('unified catalog subscription checkout', () => {
  const gateway = readFileSync('api/plan-control.ts', 'utf8');
  const client = readFileSync('src/utils/storeSubscription.ts', 'utf8');
  const cart = readFileSync('src/components/modals/B2CCartDrawerApprovalBase.tsx', 'utf8');

  it('routes canonical official plans to platform billing and merchant subscriptions to OAuth billing', () => {
    const start = gateway.indexOf("case 'catalog.subscription.checkout'");
    const end = gateway.indexOf("case 'merchant.subscription.quote'", start);
    assert.ok(start >= 0 && end > start);
    const handler = gateway.slice(start, end);
    assert.match(handler, /resolvePersistedProductCheckoutRoute\(/);
    assert.match(handler, /route\.kind === 'platform-plan'/);
    assert.match(handler, /createOwnPaidPlanCheckout\(authorization, route\.plan, body\.productId\)/);
    assert.match(handler, /route\.kind === 'free-plan'/);
    assert.match(handler, /FREE_PLAN_CHECKOUT_NOT_REQUIRED/);
    assert.match(handler, /createAuthorizedStoreSubscription\(authorization, body\)/);
    assert.match(handler, /Object\.keys\(body\)\.some\(key => key !== 'storeId' && key !== 'productId'\)/);
    assert.match(client, /post\('catalog\.subscription\.checkout'/);
    assert.match(cart, /createCatalogSubscriptionCheckout\(/);
  });
});


it('official plan checkout validates the storefront price rather than governance price', () => {
  assert.doesNotMatch(source, /loadPublicActivePlanCatalog/);
  assert.match(source, /INVALID_OFFICIAL_PLAN_PRICE/);
  assert.match(source, /planId === 'free' \? productPrice !== 0 : productPrice <= 0/);
});

it('monthly catalog checkout fails closed on unknown contract and payment fields', () => {
  const gateway = readFileSync('api/plan-control.ts', 'utf8');
  const start = gateway.indexOf("case 'catalog.subscription.checkout'");
  const end = gateway.indexOf("case 'merchant.subscription.quote'", start);
  assert.ok(start >= 0 && end > start);
  const handler = gateway.slice(start, end);
  assert.match(handler, /Object\.keys\(body\)\.some\(key => key !== 'storeId' && key !== 'productId'\)/);
  assert.ok(handler.indexOf('Object.keys(body)') < handler.indexOf('resolvePersistedProductCheckoutRoute'),
    'Unknown contract terms must be rejected before billing route resolution');
});


it('unified subscription route rejects ordinary merchandise before payment routing', () => {
  const source = readFileSync('server/admin/officialPlanProductLookup.ts', 'utf8');
  assert.match(source, /input\.allowMerchantSubscription && parsedModality\.mode !== 'subscription'/);
  assert.match(source, /PRODUCT_NOT_SUBSCRIPTION/);
  assert.ok(source.indexOf('PRODUCT_NOT_SUBSCRIPTION') < source.indexOf('return resolveCheckoutBillingRoute'),
    'Ordinary merchandise must be rejected before a subscription billing recipient is chosen');
});


describe('official storefront billing authority', () => {
  const billing = readFileSync(new URL('../server/admin/paidPlanSubscriptionService.ts', import.meta.url), 'utf8');
  it('uses mapped official product and persisted store price for provider charge', () => {
    assert.match(billing, /resolvePersistedProductCheckoutRoute/);
    assert.match(billing, /OFFICIAL_PLAN_PRODUCT_MISMATCH/);
    assert.match(billing, /monthlyPriceBRL: price/);
    assert.match(billing, /productData\?\.publicationStatus !== 'published'/);
    assert.match(billing, /productData\?\.contractDiscounts !== undefined/);
    assert.match(billing, /OFFICIAL_PLAN_PRODUCT_CHANGED/);
    assert.match(billing, /const latestOffer = await selectedPlan\(targetPlan, officialProductId\)/);
    assert.match(billing, /OFFICIAL_PLAN_PRICE_CHANGED/);
    assert.match(billing, /'X-Idempotency-Key': billingReference/);
    assert.match(billing, /adminDb\.runTransaction\(async transaction/);
    assert.match(billing, /SUBSCRIPTION_CHECKOUT_IN_PROGRESS/);
    assert.match(billing, /checkoutReservationStatus: 'completed'/);
    assert.ok(billing.indexOf('const latestOffer = await selectedPlan') < billing.indexOf("mpRequest('/preapproval',"));
    assert.match(billing, /officialProductId/);
    assert.match(billing, /officialStoreId: official\.canonicalStoreId/);
    assert.match(billing, /payerEmail: user\.email/);
  });
});

describe('admin mapping does not trust owner-editable product plan tags', () => {
  const management = readFileSync(new URL('../server/admin/officialPlanProductManagement.ts', import.meta.url), 'utf8');
  it('rejects both old and new product-level plan tags', () => {
    assert.match(management, /data\.platformPlanId !== undefined/);
    assert.match(management, /data\.kyrubPlanId !== undefined/);
  });
  it('uses the Official Store product price rather than the governance catalog at assignment', () => {
    assert.doesNotMatch(management, /loadPublicActivePlanCatalog/);
    assert.match(management, /data\.price < 0/);
    assert.match(management, /input\.planId === 'free' \? data\.price !== 0 : data\.price <= 0/);
    assert.match(management, /Number\.isSafeInteger\(Math\.round\(data\.price \* 100\)\)/);
  });
});
