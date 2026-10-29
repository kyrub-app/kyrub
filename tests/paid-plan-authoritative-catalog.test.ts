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
    assert.ok(billing.includes("completion === 'already-completed'"));
    assert.ok(billing.includes('decideReservationCompletion(billingReference, providerSubscriptionId, reservation.data() ?? {})'));
    assert.ok(billing.includes('A reserva desta contratacao foi alterada.'));
  });

  it('returns the persisted subscription after a webhook-first checkout completion', () => {
    assert.ok(billing.includes('const completed = await reservationRef.get()'));
    assert.ok(billing.includes('persisted?.providerSubscriptionId !== providerSubscriptionId'));
    assert.ok(billing.includes('subscription: persisted'));
  });

  it('allows concurrent early webhooks for the same preapproval without rewriting the reservation', () => {
    const webhook = billing.split('export const handlePaidPlanProviderWebhook')[1];
    assert.ok(webhook.includes('decideReservationCompletion(reference, providerSubscriptionId, latest.data() ?? {})'));
    assert.ok(webhook.includes("completion === 'already-completed'"));
    assert.ok(webhook.includes('await persistProviderState(ownerId, provider, recovered)'));
  });

  it('rejects mismatched early-webhook reservations before linking a subscription', () => {
    const webhook = billing.split('export const handlePaidPlanProviderWebhook')[1];
    assert.ok(webhook.includes("where('billingReference', '==', reference).limit(2)"));
    assert.ok(webhook.includes('clean(provider.payer_email).toLowerCase()'));
    assert.ok(webhook.includes('data.reservedAmountMinor'));
    assert.ok(webhook.includes('data.reservedCurrency'));
    assert.ok(webhook.includes("recurring.frequency_type !== 'months'"));
    assert.ok(webhook.includes('SUBSCRIPTION_RECONCILIATION_MISMATCH'));
    assert.ok(webhook.includes('SUBSCRIPTION_IDENTITY_CONFLICT'));
  });

  it('rejects a provider preapproval already linked to another owner during webhook recovery', () => {
    const webhook = billing.split('export const handlePaidPlanProviderWebhook')[1];
    assert.ok(webhook.includes("where('providerSubscriptionId', '==', providerSubscriptionId).limit(2).get()"));
    assert.ok(webhook.includes('linked.docs.some(doc => doc.id !== ownerId)'));
    assert.ok(webhook.includes('SUBSCRIPTION_IDENTITY_CONFLICT'));
  });

  it('retains compiled fallback for public plan display only', () => {
    assert.match(catalog, /source: 'compiled_v1'/);
    assert.match(catalog, /source: 'control_plane'/);
  });
});
