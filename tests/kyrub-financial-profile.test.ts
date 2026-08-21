import assert from 'node:assert/strict';
import test from 'node:test';
import { canKyrubFinancialProfileReceive } from '../shared/kyrubFinancialProfile';
import {
  bindKyrubFinancialProviderRecipient,
  createKyrubFinancialProfile,
  grantKyrubFinancialCapabilities,
  transitionKyrubFinancialProfile,
} from '../server/payments/financialProfileOnboarding';

test('financial identity belongs to the Kyrub user rather than a business role', () => {
  const profile = createKyrubFinancialProfile({
    userId: 'user-1',
    now: new Date('2026-08-21T20:00:00.000Z'),
  });
  assert.equal(profile.userId, 'user-1');
  assert.equal(profile.status, 'not_started');
  assert.deepEqual(profile.capabilities, []);
  assert.equal('storeId' in profile, false);
  assert.equal('driverId' in profile, false);
  assert.equal('freelancerId' in profile, false);
});

test('onboarding follows an explicit provider-agnostic state machine', () => {
  let profile = createKyrubFinancialProfile({ userId: 'user-1' });
  profile = transitionKyrubFinancialProfile({ profile, status: 'identity_required' });
  profile = transitionKyrubFinancialProfile({ profile, status: 'provider_pending' });
  profile = transitionKyrubFinancialProfile({ profile, status: 'under_review' });
  profile = transitionKyrubFinancialProfile({ profile, status: 'active' });
  assert.equal(profile.status, 'active');

  assert.throws(
    () => transitionKyrubFinancialProfile({ profile, status: 'identity_required' }),
    /FINANCIAL_PROFILE_INVALID_TRANSITION/
  );
});

test('provider binding stores identifiers/status but no KYC document payload', () => {
  const profile = createKyrubFinancialProfile({ userId: 'user-1' });
  const bound = bindKyrubFinancialProviderRecipient({
    profile,
    binding: {
      provider: 'provider-a',
      environment: 'sandbox',
      externalRecipientId: 'recipient-123',
      status: 'pending',
    },
  });

  assert.equal(bound.providerBindings[0]?.externalRecipientId, 'recipient-123');
  assert.equal('document' in bound.providerBindings[0]!, false);
  assert.equal('accessToken' in bound.providerBindings[0]!, false);
});

test('receiving capability is granted only after financial profile activation', () => {
  const initial = createKyrubFinancialProfile({ userId: 'user-1' });
  assert.throws(
    () => grantKyrubFinancialCapabilities({ profile: initial, capabilities: ['receive'] }),
    /FINANCIAL_PROFILE_NOT_ACTIVE/
  );

  let active = transitionKyrubFinancialProfile({ profile: initial, status: 'identity_required' });
  active = transitionKyrubFinancialProfile({ profile: active, status: 'provider_pending' });
  active = transitionKyrubFinancialProfile({ profile: active, status: 'active' });
  active = grantKyrubFinancialCapabilities({
    profile: active,
    capabilities: ['receive', 'pix', 'receive'],
  });

  assert.deepEqual(active.capabilities, ['receive', 'pix']);
  assert.equal(canKyrubFinancialProfileReceive(active), true);
});
