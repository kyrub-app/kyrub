import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const officialStoreSource = readFileSync('server/admin/officialStoreService.ts', 'utf8');
const planRouterSource = readFileSync('api/plan-control.ts', 'utf8');
const planBillingSource = readFileSync('server/admin/paidPlanSubscriptionService.ts', 'utf8');
const merchantBillingSource = readFileSync('server/payments/storeSubscriptionService.ts', 'utf8');

test('official store identity has a single persisted authority with canonical and legacy identifiers', () => {
  assert.match(officialStoreSource, /const OFFICIAL_STORE_PATH = 'kyrub_admin\/official_store'/);
  assert.match(officialStoreSource, /export const getOfficialStoreIdentity/);
  assert.match(officialStoreSource, /canonicalStoreId: candidate\.canonicalStoreId/);
  assert.match(officialStoreSource, /legacyStoreId: candidate\.legacyStoreId/);
  assert.match(officialStoreSource, /await requireSuperAdmin\(authorization\)/);
});

test('Kyrub plan checkout and merchant subscriptions keep separate route authorities', () => {
  assert.match(planRouterSource, /case 'store\.subscription\.checkout'/);
  assert.match(planRouterSource, /createOwnPaidPlanCheckout\(authorization, body\.plan\)/);
  assert.match(planRouterSource, /case 'merchant\.subscription\.checkout'/);
  assert.match(planRouterSource, /createAuthorizedStoreSubscription\(authorization, request\.body\)/);
  assert.match(planBillingSource, /KYRUB_BILLING_MERCADO_PAGO_ACCESS_TOKEN/);
  assert.match(merchantBillingSource, /createAuthorizedStoreSubscription/);
});

test('platform preapproval uses its persisted billing reference for provider correlation', () => {
  assert.match(planBillingSource, /const billingReference = randomUUID\(\)\.replaceAll\('-', '_'\)/);
  assert.match(planBillingSource, /external_reference: billingReference/);
  assert.match(planBillingSource, /billingReference,\s*payerEmail: user\.email/);
});

test('Kyrub plan activation requires approved payment evidence', () => {
  assert.match(planBillingSource, /loadApprovedSubscriptionPayment\(fallback\)/);
  assert.match(planBillingSource, /status === 'authorized' && paymentEvidence/);
  assert.match(planBillingSource, /await activateSubscriptionEntitlement\(ownerId, next\)/);
});

test('optional official product reference is validated before platform preapproval', () => {
  assert.match(planRouterSource, /createOwnPaidPlanCheckout\(authorization, body\.plan, body\.productId\)/);
  assert.match(planBillingSource, /validateOfficialPlanProduct\(productId, targetPlan, Math\.round\(plan\.monthlyPriceBRL \* 100\)\)/);
  assert.match(planBillingSource, /officialStoreId: officialProduct\.canonicalStoreId/);
  assert.match(planBillingSource, /officialProductId: officialProduct\.productId/);
});

test('platform preapproval sends a provider idempotency header', () => {
  assert.match(planBillingSource, /const providerIdempotencyKey =/);
  assert.match(planBillingSource, /'X-Idempotency-Key': providerIdempotencyKey/);
});

test('platform checkout reserves creation before provider call', () => {
  assert.match(planBillingSource, /const billingReference = await reservePlanCheckout\(ownerId\)/);
  assert.match(planBillingSource, /adminDb\.runTransaction\(async transaction =>/);
  assert.match(planBillingSource, /PLAN_CHECKOUT_IN_PROGRESS/);
  assert.match(planBillingSource, /finishPlanCheckout\(ownerId, billingReference, 'ready'\)/);
  assert.match(planBillingSource, /finishPlanCheckout\(ownerId, billingReference, 'failed'\)/);
});
