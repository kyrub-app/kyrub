import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildStoreSalesAnalytics,
  type StoreSalesAnalyticsOrder,
} from '../shared/storeSalesAnalytics';

const order = (
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

describe('store sales analytics', () => {
  it('keeps commercial sales separate from financial settlement semantics', () => {
    const payload = buildStoreSalesAnalytics({
      storeId: 'store-1',
      period: '30d',
      now: new Date('2026-09-26T12:00:00.000Z'),
      orders: [
        order({
          orderId: 'completed',
          status: 'completed',
          paymentStatus: 'unpaid',
          totalMinor: 3000,
          occurredAt: '2026-09-25T12:00:00.000Z',
          items: [{
            productId: 'p1',
            name: 'Produto',
            unitPriceMinor: 1000,
            quantity: 4,
            transferredQuantity: 1,
            voidedQuantity: 1,
            discountMinor: 0,
          }],
        }),
        order({
          orderId: 'cancelled',
          status: 'cancelled',
          paymentStatus: 'paid',
          totalMinor: 9000,
          occurredAt: '2026-09-25T13:00:00.000Z',
        }),
        order({
          orderId: 'open',
          status: 'preparing',
          totalMinor: 5000,
          occurredAt: '2026-09-25T14:00:00.000Z',
        }),
      ],
    });

    assert.equal(payload.summary.totalOrders, 3);
    assert.equal(payload.summary.completedOrders, 1);
    assert.equal(payload.summary.completedSalesMinor, 3000);
    assert.equal(payload.summary.averageTicketMinor, 3000);
    assert.equal(payload.summary.unitsSold, 2);
    assert.equal(payload.summary.cancelledOrders, 1);
    assert.equal(payload.summary.openOrders, 1);
    assert.equal(payload.summary.terminalCompletionRateBps, 5000);
    assert.equal(payload.products[0]?.units, 2);
    assert.equal(payload.products[0]?.grossMinor, 2000);
  });

  it('groups completed sales by channel and fulfillment without counting cancelled value', () => {
    const payload = buildStoreSalesAnalytics({
      storeId: 'store-1',
      period: '7d',
      now: new Date('2026-09-26T12:00:00.000Z'),
      orders: [
        order({ orderId: 'a', status: 'completed', sourceChannel: 'kyrub', fulfillmentType: 'pickup', totalMinor: 1000, occurredAt: '2026-09-26T10:00:00.000Z' }),
        order({ orderId: 'b', status: 'completed', sourceChannel: 'mercado_livre', fulfillmentType: 'delivery', totalMinor: 2500, occurredAt: '2026-09-25T10:00:00.000Z' }),
        order({ orderId: 'c', status: 'cancelled', sourceChannel: 'mercado_livre', fulfillmentType: 'delivery', totalMinor: 9900, occurredAt: '2026-09-24T10:00:00.000Z' }),
      ],
    });

    assert.deepEqual(payload.channels.map(item => [item.key, item.salesMinor]), [
      ['mercado_livre', 2500],
      ['kyrub', 1000],
    ]);
    assert.equal(payload.fulfillment.find(item => item.key === 'delivery')?.salesMinor, 2500);
  });

  it('compares equal rolling periods without manufacturing a percentage when the previous base is zero', () => {
    const payload = buildStoreSalesAnalytics({
      storeId: 'store-1',
      period: '7d',
      now: new Date('2026-09-26T12:00:00.000Z'),
      orders: [
        order({ orderId: 'current', status: 'completed', totalMinor: 4000, occurredAt: '2026-09-25T12:00:00.000Z' }),
      ],
    });

    assert.equal(payload.comparison?.previousCompletedSalesMinor, 0);
    assert.equal(payload.comparison?.completedSalesDeltaBps, null);
  });

  it('reads canonical and paid operational order stores and lets canonical data win duplicate order ids', () => {
    const source = readFileSync('server/payments/storeSalesAnalyticsService.ts', 'utf8');
    assert.match(source, /stores\/\$\{storeId\}\/orders/);
    assert.match(source, /artifacts\/\$\{storeId\}\/public\/data\/customerOrders/);
    assert.match(source, /for \(const doc of operationalSnapshot\.docs\)/);
    assert.match(source, /for \(const doc of canonicalSnapshot\.docs\)[\s\S]*byOrderId\.set\(order\.orderId, order\)/);
    assert.match(source, /status === 'delivered'\) return 'completed'/);
    assert.doesNotMatch(source, /canonicalPayment|EconomicLedger|providerFee/);
  });

  it('mounts Vendas directly in the runtime actually used by the Vite alias', () => {
    const router = readFileSync('src/components/RetailerPanelRuntimeRouter.tsx', 'utf8');
    const vite = readFileSync('vite.config.ts', 'utf8');
    assert.match(vite, /RetailerPanelRuntimeRouter\.tsx/);
    assert.match(router, /vendas: \{[^\n]+status: 'native'/);
    assert.match(router, /LazySalesAnalyticsRuntime/);
    assert.match(router, /import\('\.\/store\/StoreSalesAnalyticsRuntime'\)/);
    assert.match(router, /moduleId === 'vendas'[\s\S]*LazySalesAnalyticsRuntime/);
    assert.doesNotMatch(router, /moduleId === 'vendas'[\s\S]{0,400}Migração nativa/);
  });

  it('reuses the existing store-promotions serverless function instead of adding another Vercel function', () => {
    const vercel = readFileSync('vercel.json', 'utf8');
    const transport = readFileSync('server/payments/storePromotionServerlessTransport.ts', 'utf8');
    assert.match(vercel, /"source": "\/api\/store-sales-analytics"/);
    assert.match(vercel, /\/api\/health\?transport=store-promotions&surface=sales-analytics/);
    assert.match(transport, /createStoreSalesAnalyticsRouter/);
    assert.match(transport, /surface === 'sales-analytics'/);
    assert.match(transport, /'\/api\/store-sales-analytics'/);
  });

  it('UI explicitly separates commercial analytics from Financeiro Interno', () => {
    const runtime = readFileSync('src/components/store/StoreSalesAnalyticsRuntime.tsx', 'utf8');
    assert.match(runtime, /Valores financeiros liquidados, taxas, estornos e repasses continuam no Financeiro Interno/);
    assert.match(runtime, /Fluxo atual dos pedidos/);
    assert.match(runtime, /Produtos com maior saída/);
    assert.match(runtime, /Canais de venda/);
    assert.match(runtime, /Modalidade de atendimento/);
    assert.match(runtime, /Tendência de vendas concluídas/);
    assert.match(runtime, /Pedidos recentes/);
  });
});
