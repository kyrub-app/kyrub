import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

describe('paid platform plan checkout requires authoritative pricing', () => {
  const billing = readFileSync(
    new URL('../server/admin/paidPlanSubscriptionService.ts', import.meta.url), 'utf8'
  );
  const catalog = readFileSync(
    new URL('../server/admin/publicPlanCatalogService.ts', import.meta.url), 'utf8'
  );

  it('charges the persisted official product price rather than compiled catalog prices', () => {
    assert.match(billing, /monthlyPriceBRL: price/);
    assert.match(billing, /OFFICIAL_PLAN_PRODUCT_CHANGED/);
    assert.match(billing, /OFFICIAL_PLAN_PRICE_CHANGED/);
  });

  it('does not expose a stale subscription during a pending checkout reservation', () => {
    assert.match(billing, /subscription: snapshot\.data\(\)\?\.checkoutReservationStatus === 'pending'/);
    assert.match(billing, /\? null\s*: parseStoredSubscription/);
  });

  it('checks complete provider details before recovering a reserved subscription', () => {
    const recovery = billing.split('export const reconcileOwnPaidPlanSubscription')[1];
    assert.ok(recovery.includes('const recurring = record(provider.auto_recurring)'));
    assert.ok(!recovery.includes('const recurring = record(candidate.auto_recurring)'));
    assert.ok(recovery.includes('SUBSCRIPTION_RECONCILIATION_MISMATCH'));
  });

  it('permits the checkout response to finish after its verified webhook completes the same reservation', () => {
    assert.ok(billing.includes("checkoutReservationStatus === 'completed'"));
    assert.ok(billing.includes("clean(reservation.data()?.providerSubscriptionId) === providerSubscriptionId"));
    assert.ok(billing.includes('A reserva desta contratacao foi alterada.'));
  });

  it('retains compiled fallback for public plan display only', () => {
    assert.match(catalog, /source: 'compiled_v1'/);
    assert.match(catalog, /source: 'control_plane'/);
  });
});
