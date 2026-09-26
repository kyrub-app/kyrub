import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { buildStoreCrmCustomerSummary, STORE_CRM_MAX_CUSTOMERS } from '../shared/storeCrm';
import {
  buildStoreSalesAnalytics,
  type StoreSalesAnalyticsOrder,
} from '../shared/storeSalesAnalytics';

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

  it('materializes each buyer idempotently into one CRM customer and backfills before projection', () => {
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

  it('owner endpoint does not accept a customer-supplied CRM projection', () => {
    const router = readFileSync('server/payments/storeCrmRouter.ts', 'utf8');
    assert.match(router, /identity\.uid !== storeId/);
    assert.doesNotMatch(router, /request\.body/);
  });

  it('production CRM reuses the existing health serverless runtime', () => {
    const health = readFileSync('api/health.ts', 'utf8');
    const transport = readFileSync('server/payments/storeCrmServerlessTransport.ts', 'utf8');
    const vercel = readFileSync('vercel.json', 'utf8');

    assert.match(vercel, /\/api\/store-crm/);
    assert.match(vercel, /\/api\/health\?transport=store-crm/);
    assert.match(health, /transport === 'store-crm'/);
    assert.match(health, /storeCrmServerlessTransport\.js/);
    assert.match(transport, /identity\.uid !== storeId/);
    assert.match(transport, /loadStoreCrmSummary/);
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

const salesOrder = (
  input: Partial<StoreSalesAnalyticsOrder> & Pick<StoreSalesAnalyticsOrder, 'orderId' | 'status' | 'occurredAt'>
): StoreSalesAnalyticsOrder => ({
  orderId: input.orderId,
  buyerId: input.buyerId ?? 'buyer-1',
  buyerName: input.buyerName ?? 'Cliente',
  status: input.status,
  paymentStatus: input.paymentStatus ?? 'unknown',
  fulfillmentType: input.fulfillmentType ?? 'delivery',
  sourceChannel: input.sourceChannel ?? 'kyrub',
  operatorId: input.operatorId ?? '',
  operatorName: input.operatorName ?? '',
  totalMinor: input.totalMinor ?? 0,
  occurredAt: input.occurredAt,
  authority: input.authority ?? 'canonical',
  items: input.items ?? [],
});

describe('native Vendas & Analytics guard', () => {
  it('counts completed commercial value without pretending it is financial settlement', () => {
    const payload = buildStoreSalesAnalytics({
      storeId: 'store-1',
      period: '30d',
      now: new Date('2026-09-26T12:00:00.000Z'),
      orders: [
        salesOrder({
          orderId: 'completed',
          status: 'completed',
          paymentStatus: 'unpaid',
          totalMinor: 3000,
          occurredAt: '2026-09-25T12:00:00.000Z',
          items: [{ productId: 'p1', name: 'Produto', unitPriceMinor: 1000, quantity: 4, transferredQuantity: 1, voidedQuantity: 1, discountMinor: 0 }],
        }),
        salesOrder({ orderId: 'cancelled', status: 'cancelled', paymentStatus: 'paid', totalMinor: 9000, occurredAt: '2026-09-25T13:00:00.000Z' }),
        salesOrder({ orderId: 'open', status: 'preparing', totalMinor: 5000, occurredAt: '2026-09-25T14:00:00.000Z' }),
      ],
    });

    assert.equal(payload.summary.totalOrders, 3);
    assert.equal(payload.summary.completedOrders, 1);
    assert.equal(payload.summary.completedSalesMinor, 3000);
    assert.equal(payload.summary.unitsSold, 2);
    assert.equal(payload.summary.cancelledOrders, 1);
    assert.equal(payload.summary.openOrders, 1);
    assert.equal(payload.products[0]?.grossMinor, 2000);
  });

  it('is wired into the runtime actually mounted by the Vite alias', () => {
    const router = readFileSync('src/components/RetailerPanelRuntimeRouter.tsx', 'utf8');
    const vite = readFileSync('vite.config.ts', 'utf8');
    assert.match(vite, /RetailerPanelRuntimeRouter\.tsx/);
    assert.match(router, /vendas: \{[^\n]+status: 'native'/);
    assert.match(router, /LazySalesAnalyticsRuntime/);
    assert.match(router, /moduleId === 'vendas'[\s\S]*LazySalesAnalyticsRuntime/);
  });

  it('deduplicates the two order stores and reuses the existing serverless multiplexer', () => {
    const service = readFileSync('server/payments/storeSalesAnalyticsService.ts', 'utf8');
    const transport = readFileSync('server/payments/storePromotionServerlessTransport.ts', 'utf8');
    const vercel = readFileSync('vercel.json', 'utf8');
    assert.match(service, /stores\/\$\{storeId\}\/orders/);
    assert.match(service, /artifacts\/\$\{storeId\}\/public\/data\/customerOrders/);
    assert.match(service, /for \(const doc of operationalSnapshot\.docs\)[\s\S]*for \(const doc of canonicalSnapshot\.docs\)/);
    assert.match(service, /byOrderId\.set\(order\.orderId, order\)/);
    assert.match(vercel, /\/api\/health\?transport=store-promotions&surface=sales-analytics/);
    assert.match(transport, /surface === 'sales-analytics'/);
    assert.match(transport, /createStoreSalesAnalyticsRouter/);
  });
});
