import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const service = readFileSync(
  'server/payments/storeSubscriberRegistryService.ts',
  'utf8'
);
const contract = readFileSync('shared/storeSubscriberRegistry.ts', 'utf8');
const gateway = readFileSync('api/plan-control.ts', 'utf8');
const client = readFileSync('src/utils/storeSubscribers.ts', 'utf8');

test('subscriber registry is derived from canonical subscriptions instead of a parallel customer collection', () => {
  assert.match(service, /stores\/\$\{storeId\}\/subscriptions/);
  assert.match(service, /byBuyer\(subscriptions\)/);
  assert.match(service, /buyerId/);
  assert.doesNotMatch(service, /subscriptionSubscribers|subscriberCustomers/);
  assert.match(contract, /StoreSubscriberRegistrySummary/);
  assert.match(contract, /StoreSubscriberSubscriptionSummary/);
});

test('only the store owner can read or reconcile the subscriber registry', () => {
  assert.match(service, /authenticateConsultantRequest\(authorization\)/);
  assert.match(service, /identity\.uid !== ownerUserId/);
  assert.match(service, /STORE_SUBSCRIBER_FORBIDDEN/);
  assert.match(gateway, /merchant\.subscribers\.list/);
  assert.match(gateway, /merchant\.subscribers\.reconcile/);
});

test('paid subscription relationships merge into the same CRM customer without creating a second CRM', () => {
  assert.match(service, /stores\/\$\{input\.storeId\}\/crmCustomers\/\$\{input\.buyerId\}/);
  assert.match(service, /subscriptionIdentity/);
  assert.match(service, /subscriptionStats/);
  assert.match(service, /\{ merge: true \}/);
  assert.doesNotMatch(service, /crmSubscribers|subscriberCrm/);
});

test('abandoned or merely pending checkout does not become a CRM customer', () => {
  assert.match(service, /hasPaidRelationship/);
  assert.match(service, /subscription\.paymentConfirmedAt \|\| subscription\.activatedAt/);
  assert.match(service, /if \(paid\.length === 0\) return false/);
});

test('subscription purchase never invents marketing consent and existing CRM fields remain untouched', () => {
  assert.match(service, /whatsapp: \{ status: 'unknown'/);
  assert.match(service, /email: \{ status: 'unknown'/);
  assert.match(service, /sms: \{ status: 'unknown'/);
  assert.match(service, /existing\.exists/);
  assert.doesNotMatch(service, /marketingConsent:\s*\{[^}]*granted/s);
  assert.doesNotMatch(service, /notes:\s*|contactHistory:\s*|history:\s*/);
});

test('merchant client sends only store identity for registry operations', () => {
  assert.match(client, /merchant\.subscribers\.list&storeId=/);
  assert.match(client, /merchant\.subscribers\.reconcile/);
  assert.match(client, /JSON\.stringify\(\{ storeId \}\)/);
  assert.doesNotMatch(client, /provider|credential|externalAccountId|marketingConsent/);
});
