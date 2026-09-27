import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync('server/payments/storeSubscriptionBenefitService.ts', 'utf8');
const contract = readFileSync('shared/storeSubscriptionBenefits.ts', 'utf8');
const gateway = readFileSync('api/plan-control.ts', 'utf8');
const client = readFileSync('src/utils/storeSubscriptionBenefits.ts', 'utf8');
const platformBilling = readFileSync('server/admin/paidPlanSubscriptionService.ts', 'utf8');

test('each approved recurring provider invoice creates one deterministic canonical benefit cycle', () => {
  assert.match(service, /cycleIdForInvoice/);
  assert.match(service, /hash\(invoiceId\)/);
  assert.match(service, /benefitCycles\/\$\{cycleId\}/);
  assert.match(service, /source\.state !== 'active'/);
  assert.match(service, /source\.providerPaymentStatus !== 'approved'/);
  assert.match(service, /source\.providerPaymentStatusDetail !== 'accredited'/);
  assert.match(service, /source\.providerInvoiceId/);
  assert.match(service, /transaction\.create\(reference, cycle\)/);
  assert.match(service, /assertCycleMatchesSource/);
});

test('benefit quantity comes from immutable subscription terms, never from checkout or benefit client input', () => {
  assert.match(service, /source\.terms\.benefit\.unitsPerCycle/);
  assert.match(service, /source\.terms\.benefit\.kind === 'access'/);
  assert.match(contract, /grantedUnits: number \| null/);
  assert.match(contract, /remainingUnits: number \| null/);
  assert.doesNotMatch(client, /grantedUnits|unitsPerCycle|benefitKind/);
});

test('paid cycles support access, service usage credits and recurring delivery without fabricating fulfillment orders', () => {
  assert.match(service, /'access'/);
  assert.match(service, /'usage_credits'/);
  assert.match(service, /'recurring_delivery'/);
  assert.match(service, /billingPeriodEndsAt/);
  assert.doesNotMatch(service, /createCustomerOrder|persistCustomerOrder|createDelivery|materialize.*Order/i);
});

test('merchant usage consumption is owner-authorized, active-cycle-only and idempotent', () => {
  assert.match(service, /authenticateConsultantRequest\(authorization\)/);
  assert.match(service, /identity\.uid !== store\.ownerUserId/);
  assert.match(service, /source\.state !== 'active'/);
  assert.match(service, /operationId/);
  assert.match(service, /usage_\$\{hash\(operationId\)/);
  assert.match(service, /usageSnapshot\.exists/);
  assert.match(service, /duplicate: true/);
  assert.match(service, /SUBSCRIPTION_BENEFIT_USAGE_ID_CONFLICT/);
  assert.match(service, /SUBSCRIPTION_BENEFIT_INSUFFICIENT_UNITS/);
  assert.match(service, /current\.remainingUnits - units/);
  assert.match(service, /transaction\.create\(usageRef, usage\)/);
});

test('access memberships are not decremented as fake units', () => {
  assert.match(service, /cycle\.benefitKind === 'access'/);
  assert.match(service, /SUBSCRIPTION_BENEFIT_ACCESS_NOT_CONSUMABLE/);
  assert.match(service, /remainingUnits: units/);
});

test('merchant checkout, reconcile and webhook backfill benefit cycles only through plan-control', () => {
  assert.match(gateway, /reconcileStoreSubscriptionBenefitCycle/);
  assert.match(gateway, /merchant\.subscription\.webhook/);
  assert.match(gateway, /merchant\.subscription\.checkout/);
  assert.match(gateway, /merchant\.subscription\.reconcile/);
  assert.match(gateway, /merchant\.subscription\.benefits\.list/);
  assert.match(gateway, /merchant\.subscription\.benefit\.consume/);
  assert.doesNotMatch(platformBilling, /storeSubscriptionBenefit|benefitCycles/);
});

test('benefit client can list and consume but cannot choose provider, payment evidence or grant quantity', () => {
  assert.match(client, /merchant\.subscription\.benefits\.list/);
  assert.match(client, /merchant\.subscription\.benefit\.consume/);
  assert.match(client, /operationId/);
  assert.doesNotMatch(client, /providerInvoiceId|providerPaymentId|paymentConfirmedAt|credentialScopeId|externalAccountId/);
});
