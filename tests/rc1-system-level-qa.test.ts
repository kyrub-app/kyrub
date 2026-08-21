import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const paymentIntent = readFileSync('server/payments/paymentIntentRouter.ts', 'utf8');
const payments = readFileSync('shared/kyrubPaymentAllocations.ts', 'utf8');
const financialProfile = readFileSync('shared/kyrubFinancialProfile.ts', 'utf8');
const inventory = readFileSync('shared/inventoryIngredientIntelligence.ts', 'utf8');
const opportunity = readFileSync('shared/kyrubOpportunityEngine.ts', 'utf8');
const autonomy = readFileSync('shared/kyrubAutonomy.ts', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');
const logistics = readFileSync('server/delivery/deliveryOpportunityRouter.ts', 'utf8');
const tracking = readFileSync('server/delivery/deliveryTrackingRouter.ts', 'utf8');

test('RC1 system gate preserves server-authoritative marketplace payment boundary', () => {
  assert.match(paymentIntent, /PaymentIntent|payment intent/i);
  assert.match(paymentIntent, /pending/);
  assert.doesNotMatch(paymentIntent, /client.*paid|browser.*paid/i);
});

test('RC1 system gate preserves generic financial identity and one payer to N allocations', () => {
  assert.match(financialProfile, /userId/);
  assert.match(financialProfile, /externalRecipientId/);
  assert.match(financialProfile, /capabilities/);
  assert.match(payments, /payerUserId/);
  assert.match(payments, /allocations/);
  assert.match(payments, /recipientUserId/);
  assert.match(payments, /courier/);
  assert.match(payments, /freelancer/);
});

test('RC1 system gate keeps ingredient stock separate from sellable product catalog', () => {
  assert.match(inventory, /InventoryCatalogRecord/);
  assert.match(inventory, /usedByProductIds/);
  assert.match(inventory, /calculateIngredientDemand/);
  assert.doesNotMatch(inventory, /publicProducts/);
});

test('RC1 system gate keeps opportunity detection explainable and proposal-only', () => {
  assert.match(opportunity, /authoritative_fact/);
  assert.match(opportunity, /calculation/);
  assert.match(opportunity, /inference/);
  assert.match(opportunity, /evidenceRefs/);
  assert.match(opportunity, /autonomyLevel: 2/);
  assert.match(autonomy, /globalKillSwitch/);
  assert.match(autonomy, /Kill switches intentionally dominate/);
});

test('RC1 system gate keeps delivery tracking private and settlement separate from operational completion', () => {
  assert.match(tracking, /TRACKING_FORBIDDEN/);
  assert.match(tracking, /actorId === storeId/);
  assert.match(tracking, /actorId === buyerId/);
  assert.match(tracking, /actorId === courierId/);
  assert.match(logistics, /status: 'done'/);
  assert.doesNotMatch(logistics, /settlePayment|releaseFunds|payout\(/);
});

test('RC1 system gate keeps recursive artifact writes from reverting to authenticated-anywhere', () => {
  assert.doesNotMatch(
    rules,
    /match \/artifacts\/\{tenantId\}\/\{document=\*\*\}[\s\S]{0,400}allow write:\s*if\s+isSignedIn\(\)/
  );
});
