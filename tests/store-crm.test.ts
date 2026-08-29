import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { deriveStoreCrmSegments } from '../shared/storeCrm';

describe('store CRM mirror', () => {
  test('segments follow the same relationship recurrence thresholds', () => {
    assert.deepEqual(
      deriveStoreCrmSegments({
        confirmedPurchases: 0,
        pointsBalance: 0,
        challengeProgressCount: 0,
        rewardRedemptionCount: 0,
      }),
      []
    );
    assert.deepEqual(
      deriveStoreCrmSegments({
        confirmedPurchases: 1,
        pointsBalance: 0,
        challengeProgressCount: 0,
        rewardRedemptionCount: 0,
      }),
      ['first_purchase']
    );
    assert.deepEqual(
      deriveStoreCrmSegments({
        confirmedPurchases: 3,
        pointsBalance: 20,
        challengeProgressCount: 1,
        rewardRedemptionCount: 0,
      }),
      ['recurring', 'points_available', 'challenge_engaged']
    );
    assert.deepEqual(
      deriveStoreCrmSegments({
        confirmedPurchases: 25,
        pointsBalance: 0,
        challengeProgressCount: 2,
        rewardRedemptionCount: 1,
      }),
      ['recurring', 'frequent', 'loyal', 'challenge_engaged', 'reward_redeemer']
    );
  });

  test('CRM derives economic and loyalty data from canonical sources', () => {
    const service = readFileSync('server/payments/storeCrmService.ts', 'utf8');

    assert.match(service, /stores\/\$\{storeId\}\/payments/);
    assert.match(service, /stores\/\$\{storeId\}\/storePointLedger/);
    assert.match(service, /stores\/\$\{storeId\}\/challengeProgress/);
    assert.match(service, /stores\/\$\{storeId\}\/rewardRedemptions/);
    assert.match(service, /stores\/\$\{storeId\}\/orders/);
    assert.match(service, /isPaymentAuthoritativelyPaid\(payment\.status\)/);
    assert.match(service, /deriveStorePointBalance\(customerLedger\)/);
    assert.match(service, /deriveStoreRelationshipLevel\(confirmedPurchases\)/);
    assert.match(service, /isStoreRewardAvailableAt\(reward, generatedAt\)/);
  });

  test('CRM is a read projection and does not persist a parallel CRM balance', () => {
    const service = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    const contract = readFileSync('shared/storeCrm.ts', 'utf8');

    assert.doesNotMatch(service, /collection\([^\n]*storeCrm/i);
    assert.doesNotMatch(service, /doc\([^\n]*storeCrm/i);
    assert.doesNotMatch(contract, /editablePoints|manualPoints|storedBalance|crmBalance/i);
    assert.match(contract, /pointsBalance: number/);
  });

  test('only the authenticated store owner can request the CRM', () => {
    const router = readFileSync('server/payments/storeCrmRouter.ts', 'utf8');
    const client = readFileSync('src/utils/storeCrm.ts', 'utf8');

    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /identity\.uid !== storeId/);
    assert.match(router, /STORE_CRM_FORBIDDEN/);
    assert.match(client, /user\.uid !== storeId/);
    assert.match(client, /\/api\/store-crm\?storeId=/);
    assert.match(client, /method: 'GET'/);
    assert.doesNotMatch(client, /body:/);
  });

  test('customer identity is mirrored from canonical order/profile data, not browser input', () => {
    const service = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    const router = readFileSync('server/payments/storeCrmRouter.ts', 'utf8');

    assert.match(service, /buyerName/);
    assert.match(service, /buyerEmail/);
    assert.match(service, /users\/\$\{customerId\}/);
    assert.match(service, /isProfileVisible !== false/);
    assert.doesNotMatch(router, /request\.body/);
  });

  test('CRM UI is mounted into Clients and exposes derived relationship metrics', () => {
    const bridge = readFileSync('src/components/store/StoreCrmBridge.tsx', 'utf8');
    const panel = readFileSync('src/components/customer/StoreCrmPanel.tsx', 'utf8');
    const app = readFileSync('src/App.tsx', 'utf8');

    assert.match(bridge, /erp-clientes-tab/);
    assert.match(bridge, /kyrub-store-crm-host/);
    assert.match(bridge, /<StoreCrmPanel storeId=\{user\.uid\} \/>/);
    assert.match(app, /<StoreCrmBridge \/>/);
    assert.match(panel, /CRM · Clientes/);
    assert.match(panel, /Receita confirmada/);
    assert.match(panel, /Pontos em aberto/);
    assert.match(panel, /Ticket médio/);
    assert.match(panel, /recompensas são derivados dos registros reais e não são editáveis aqui/);
  });

  test('Store CRM never becomes the K-Coin economy', () => {
    const contract = readFileSync('shared/storeCrm.ts', 'utf8');
    const service = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    assert.doesNotMatch(contract, /K-?Coins?|k_coins?/i);
    assert.doesNotMatch(service, /K-?Coins?|k_coins?/i);
  });
});
