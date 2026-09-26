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

  it('server derives CRM from canonical orders, payments, ledger, challenges and redemptions', () => {
    const source = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    assert.match(source, /stores\/\$\{storeId\}\/orders/);
    assert.match(source, /stores\/\$\{storeId\}\/crmCustomers/);
    assert.match(source, /stores\/\$\{storeId\}\/payments/);
    assert.match(source, /stores\/\$\{storeId\}\/storePointLedger/);
    assert.match(source, /stores\/\$\{storeId\}\/challengeProgress/);
    assert.match(source, /stores\/\$\{storeId\}\/rewardRedemptions/);
    assert.match(source, /deriveStorePointBalance/);
    assert.match(source, /isPaymentAuthoritativelyPaid/);
  });

  it('materializes each canonical buyer idempotently into one CRM customer before projection', () => {
    const source = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    assert.match(source, /crmCustomerPath\(input\.storeId\).*customer\.customerId/s);
    assert.match(source, /orderCount: sorted\.length/);
    assert.match(source, /materializeCanonicalOrders\(orderSnapshot\.docs, storeId\)/);
    assert.match(source, /await reconcileCanonicalOrdersIntoCrm/);
    assert.match(source, /customerIds\.add\(customer\.customerId\)/);
  });

  it('new CRM customers start marketing channels unknown without overwriting existing consent or relationship history', () => {
    const source = readFileSync('server/payments/storeCrmService.ts', 'utf8');
    assert.match(source, /whatsapp: \{ status: 'unknown'/);
    assert.match(source, /email: \{ status: 'unknown'/);
    assert.match(source, /sms: \{ status: 'unknown'/);
    assert.match(source, /exists \? \{\} : \{/);
    assert.match(source, /marketingConsent: defaultMarketingConsent\(\)/);
    assert.match(source, /\{ merge: true \}/);
    assert.doesNotMatch(source, /\bnotes:/);
    assert.doesNotMatch(source, /\bcontactHistory:/);
  });

  it('buyer POST authorizes from the persisted order and accepts canonical or operational order storage', () => {
    const router = readFileSync('server/payments/storeCrmRouter.ts', 'utf8');
    const syncService = readFileSync('server/payments/storeCrmOrderSyncService.ts', 'utf8');

    assert.match(router, /router\.get\('/);
    assert.match(router, /identity\.uid !== storeId/);
    assert.match(router, /router\.post\('/);
    assert.match(router, /authenticatedBuyerId: identity\.uid/);
    assert.doesNotMatch(router, /request\.body\?\.customerId/);

    assert.match(syncService, /stores\/\$\{storeId\}\/orders/);
    assert.match(syncService, /artifacts\/\$\{storeId\}\/public\/data\/customerOrders/);
    assert.match(syncService, /loadTargetOrder\(storeId, orderId\)/);
    assert.match(syncService, /targetOrder\.customerId !== authenticatedBuyerId/);
    assert.match(syncService, /\.where\('buyerId', '==', customerId\)/);
  });

  it('deduplicates canonical and operational copies by order id before computing absolute stats', () => {
    const source = readFileSync('server/payments/storeCrmOrderSyncService.ts', 'utf8');
    assert.match(source, /const byOrderId = new Map<string, PersistedCrmOrder>\(\)/);
    assert.match(source, /byOrderId\.set\(order\.orderId, order\)/);
    assert.match(source, /orderCount: orders\.length/);
    assert.match(source, /existing\.exists/);
    assert.match(source, /marketingConsent: defaultMarketingConsent\(\)/);
    assert.match(source, /\{ merge: true \}/);
    assert.doesNotMatch(source, /\bnotes:/);
    assert.doesNotMatch(source, /\bcontactHistory:/);
    assert.doesNotMatch(source, /orderCount:\s*[^\n]*\+\s*1/);
  });

  it('owner CRM GET reconciles historical canonical and operational orders after the legacy projection', () => {
    const transport = readFileSync('server/payments/storeCrmServerlessTransport.ts', 'utf8');
    const localRouter = readFileSync('server/payments/storeCrmRouter.ts', 'utf8');
    const syncService = readFileSync('server/payments/storeCrmOrderSyncService.ts', 'utf8');

    assert.match(syncService, /reconcilePersistedCustomerOrdersIntoCrm/);
    assert.match(syncService, /collection\(canonicalOrderPath\(storeId\)\)\.get\(\)/);
    assert.match(syncService, /collection\(operationalOrderPath\(storeId\)\)\.get\(\)/);
    assert.match(transport, /const summary = await loadStoreCrmSummary\(\{ storeId \}\);\s*await reconcilePersistedCustomerOrdersIntoCrm\(\{ storeId \}\);\s*response\.status\(200\)\.json\(summary\)/s);
    assert.match(localRouter, /const summary = await loadStoreCrmSummary\(\{ storeId \}\);\s*await reconcilePersistedCustomerOrdersIntoCrm\(\{ storeId \}\);\s*response\.status\(200\)\.json\(summary\)/s);
  });

  it('confirmed Mercado Pago marketplace orders write through to CRM after order materialization without invalidating the webhook', () => {
    const webhook = readFileSync('server/payments/mercadoPagoWebhook.ts', 'utf8');
    assert.match(webhook, /await processVerifiedPaymentWebhook/);
    assert.match(webhook, /await attachPreparedCustomerDestinationResolutionToOperationalOrder/);
    assert.match(webhook, /if \(result\.orderId\)/);
    assert.match(webhook, /await syncPersistedCustomerOrderIntoCrm/);
    assert.match(webhook, /catch \(error\)[\s\S]*CRM ficará para a reconciliação/);
  });

  it('production CRM reuses the existing health serverless runtime for GET and POST', () => {
    const health = readFileSync('api/health.ts', 'utf8');
    const transport = readFileSync('server/payments/storeCrmServerlessTransport.ts', 'utf8');
    const vercel = readFileSync('vercel.json', 'utf8');

    assert.match(vercel, /\/api\/store-crm/);
    assert.match(vercel, /\/api\/health\?transport=store-crm/);
    assert.match(health, /transport === 'store-crm'/);
    assert.match(health, /storeCrmServerlessTransport\.js/);
    assert.match(transport, /method !== 'GET' && method !== 'POST'/);
    assert.match(transport, /identity\.uid !== storeId/);
    assert.match(transport, /authenticatedBuyerId: identity\.uid/);
    assert.match(transport, /syncCanonicalOrderCustomerIntoCrm/);
    assert.match(transport, /loadStoreCrmSummary/);
  });

  it('client write-through sends only authenticated store and order identifiers', () => {
    const client = readFileSync('src/utils/storeCrm.ts', 'utf8');
    assert.match(client, /getIdToken\(\)/);
    assert.match(client, /\/api\/store-crm\?storeId=/);
    assert.match(client, /method: 'POST'/);
    assert.match(client, /JSON\.stringify\(\{ storeId, orderId \}\)/);
    assert.doesNotMatch(client, /customerId/);
    assert.doesNotMatch(client, /pointsBalance/);
  });

  it('canonical order persistence runs CRM sync only after a durable canonical write and never invalidates the order on sync failure', () => {
    const orders = readFileSync('src/utils/customerOrders.ts', 'utf8');
    assert.match(orders, /await batch\.commit\(\);\s*await syncPersistedCanonicalOrderToCrm/s);
    assert.match(orders, /if \(existingCanonical\.exists\(\)\)[\s\S]*await setDoc\(legacyReference, order\);[\s\S]*await syncPersistedCanonicalOrderToCrm/);
    assert.match(orders, /try \{\s*await syncCanonicalOrderToStoreCrm/s);
    assert.match(orders, /catch \(error\)[\s\S]*sincronização imediata do CRM ficará para a reconciliação/);
  });

  it('CRM UI labels the data as canonical relationship projection', () => {
    const panel = readFileSync('src/components/store/StoreCrmRelationshipPanel.tsx', 'utf8');
    assert.match(panel, /CRM · Relacionamento/);
    assert.match(panel, /Pontos da Loja/);
    assert.match(panel, /completedChallenges/);
    assert.match(panel, /rewardRedemptions/);
  });
});
