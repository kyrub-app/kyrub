import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKyrubStoreConnection,
  assertStoreConnectionTenant,
  channelsFromMerchantAnswer,
  type KyrubStoreConnection,
} from '../shared/storeConnections';

const connection = (storeId = 'store-a'): KyrubStoreConnection => ({
  id: 'connection-1',
  scope: 'store',
  provider: 'mercado_livre',
  channel: 'mercado_livre',
  storeId,
  externalAccountId: 'seller-123',
  connectedByUserId: 'user-1',
  syncAuthority: 'manual_review',
  status: 'connected',
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
});

test('store connections are explicitly tenant scoped', () => {
  assert.equal(assertKyrubStoreConnection(connection()).scope, 'store');
  assert.throws(() => assertStoreConnectionTenant('store-b', connection()), /TENANT_MISMATCH/);
});

test('merchant onboarding can recognize existing commerce channels without connecting them', () => {
  assert.deepEqual(
    channelsFromMerchantAnswer('Eu vendo no Mercado Livre, Shopee, iFood e Instagram.'),
    ['mercado_livre', 'shopee', 'ifood', 'instagram']
  );
});
