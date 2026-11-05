import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStoreCommercialRecipientAuthority } from '../shared/commercialRecipientAuthority.js';
import { resolvePrepaidRenewalRecipientBinding } from '../server/payments/prepaidRenewalRecipientBinding.js';
import { assertAuthenticatedPrepaidRenewalPixRecipient } from '../server/payments/prepaidRenewalPixLockedExecution.js';

const authority = (externalAccountId: string, ownerUserId = 'owner-a') =>
  buildStoreCommercialRecipientAuthority({
    context: 'store_subscription', canonicalStoreId: 'store-a',
    ownerUserId, credentialScopeId: ownerUserId, externalAccountId,
  });
const assertCurrent = (account: string, owner = 'owner-a') => {
  const recipient = resolvePrepaidRenewalRecipientBinding({
    storeId: 'store-a', storedSellerCredentialScopeId: 'owner-a',
    authority: authority(account, owner),
  });
  assertAuthenticatedPrepaidRenewalPixRecipient({
    recipient, trustedCredentialScopeId: 'owner-a',
    trustedExternalAccountId: '7654321',
  });
};

test('reconciliation current merchant binding accepts unchanged seller', () => {
  assert.doesNotThrow(() => assertCurrent('7654321'));
});
test('reconciliation refuses a rotated external account before provider lookup', () => {
  assert.throws(() => assertCurrent('9999999'), /RENEWAL_PIX_TRANSPORT_AUTHORITY_MISMATCH/);
});
test('reconciliation refuses a changed OAuth owner before provider lookup', () => {
  assert.throws(() => assertCurrent('7654321', 'owner-b'), /RENEWAL_RECIPIENT_AUTHORITY_MISMATCH/);
});
