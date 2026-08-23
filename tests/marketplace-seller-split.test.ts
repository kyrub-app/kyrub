import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMarketplaceSellerConnection,
  buildMarketplaceSplitOneToOnePlan,
  splitPlanMovesMoney,
} from '../shared/marketplaceSellerSplit';

const connection = {
  storeId: 'store-1',
  provider: 'mercado_pago' as const,
  status: 'connected' as const,
  externalSellerId: 'seller-123',
  oauthConnectionId: 'oauth-1',
  credentialReference: 'vault:store-1:mercado-pago',
  connectedByUserId: 'owner-1',
  connectedAt: '2026-08-23T19:00:00.000Z',
};

test('seller connection requires OAuth identity and Vault reference, never plaintext token material', () => {
  assert.equal(assertMarketplaceSellerConnection(connection), connection);
  assert.throws(
    () => assertMarketplaceSellerConnection({ ...connection, credentialReference: 'access_token:abc' }),
    /PLAINTEXT_CREDENTIAL_FORBIDDEN/
  );
});

test('split 1:1 preserves exact gross = seller + application fee', () => {
  const plan = buildMarketplaceSplitOneToOnePlan({
    paymentIntentId: 'pi-1',
    connection,
    grossAmountMinor: 10_000,
    applicationFeeMinor: 500,
  });
  assert.equal(plan.sellerAmountMinor, 9_500);
  assert.equal(plan.sellerAmountMinor + plan.applicationFeeMinor, plan.grossAmountMinor);
  assert.equal(plan.status, 'planned');
});

test('split cannot be planned for disconnected seller or impossible fee', () => {
  assert.throws(
    () => buildMarketplaceSplitOneToOnePlan({ paymentIntentId: 'pi-2', connection: { ...connection, status: 'disconnected' }, grossAmountMinor: 1000, applicationFeeMinor: 100 }),
    /SELLER_CONNECTION_NOT_CONNECTED/
  );
  assert.throws(
    () => buildMarketplaceSplitOneToOnePlan({ paymentIntentId: 'pi-3', connection, grossAmountMinor: 1000, applicationFeeMinor: 1000 }),
    /SPLIT_APPLICATION_FEE_EXCEEDS_PAYMENT/
  );
});

test('planning a split does not itself move or settle money', () => {
  assert.equal(splitPlanMovesMoney(), false);
});
