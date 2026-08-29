import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildStoreCrmCustomerSummary, STORE_CRM_MAX_CUSTOMERS } from '../shared/storeCrm';

describe('store CRM relationship projection', () => {
  it('derives level from confirmed purchase recurrence', () => {
    const customer = buildStoreCrmCustomerSummary({
      customerId: 'customer-1',
      displayName: 'Cliente',
      photoUrl: '',
      confirmedPurchases: 10,
      confirmedSpentMinor: 24500,
      lastActivityAt: '2026-08-29T00:00:00.000Z',
      pointsBalance: 90,
      activeChallenges: 1,
      completedChallenges: 2,
      rewardRedemptions: 1,
    });
    assert.equal(customer.level.key, 'frequent');
    assert.equal(customer.confirmedSpentMinor, 24500);
  });

  it('caps the CRM projection fan-out', () => {
    assert.equal(STORE_CRM_MAX_CUSTOMERS, 100);
  });

  it('server derives CRM from canonical payments, ledger, challenges and redemptions', () => {
    const source = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    assert.match(source, /stores\/\$\{storeId\}\/payments/);
    assert.match(source, /stores\/\$\{storeId\}\/storePointLedger/);
    assert.match(source, /stores\/\$\{storeId\}\/challengeProgress/);
    assert.match(source, /stores\/\$\{storeId\}\/rewardRedemptions/);
    assert.match(source, /deriveStorePointBalance/);
    assert.match(source, /isPaymentAuthoritativelyPaid/);
  });

  it('owner endpoint does not accept a customer-supplied CRM projection', () => {
    const router = readFileSync('server/payments/storeCrmRouter.ts', 'utf8');
    assert.match(router, /identity\.uid !== storeId/);
    assert.doesNotMatch(router, /request\.body/);
  });

  it('client sends only authenticated store CRM read request', () => {
    const client = readFileSync('src/utils/storeCrm.ts', 'utf8');
    assert.match(client, /getIdToken\(\)/);
    assert.match(client, /\/api\/store-crm\?storeId=/);
    assert.doesNotMatch(client, /customerId/);
    assert.doesNotMatch(client, /pointsBalance/);
  });

  it('CRM UI labels the data as canonical relationship projection', () => {
    const panel = readFileSync('src/components/store/StoreCrmRelationshipPanel.tsx', 'utf8');
    assert.match(panel, /CRM · Relacionamento/);
    assert.match(panel, /Pontos da Loja/);
    assert.match(panel, /completedChallenges/);
    assert.match(panel, /rewardRedemptions/);
  });
});
