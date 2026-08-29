import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildRecentStoreEconomyActivity,
  combineEconomicAllocationLifecycleTotals,
  deriveRecentEconomicAllocationWindow,
  deriveRefundShareBps,
  type AdminPlatformEconomyRecentEntry,
} from '../shared/adminPlatformEconomy';
import { buildMarketplaceEconomicAllocationSnapshot } from '../shared/economicFeesSubsidies';

const entry = (
  overrides: Partial<AdminPlatformEconomyRecentEntry> = {}
): AdminPlatformEconomyRecentEntry => ({
  id: 'payment:capture:pay-1',
  storeId: 'store-1',
  kind: 'payment_capture',
  amountMinor: 2950,
  paymentId: 'pay-1',
  paymentContext: 'marketplace',
  provider: 'mercado_pago',
  sourceAuthority: 'provider_webhook',
  occurredAt: '2026-08-29T10:00:00.000Z',
  ...overrides,
});

const allocationAggregate = (overrides: Partial<{
  count: number;
  deliveryFeeMinor: number;
  courierRemunerationMinor: number;
  storeSubsidyMinor: number;
  kyrubIncentiveMinor: number;
  partnerSubsidyMinor: number;
  observedCostsMinor: number;
}> = {}) => ({
  count: 0,
  deliveryFeeMinor: 0,
  courierRemunerationMinor: 0,
  storeSubsidyMinor: 0,
  kyrubIncentiveMinor: 0,
  partnerSubsidyMinor: 0,
  observedCostsMinor: 0,
  ...overrides,
});

describe('admin platform economy', () => {
  test('refund share is a bounded basis-point projection', () => {
    assert.equal(deriveRefundShareBps(10000, 2500), 2500);
    assert.equal(deriveRefundShareBps(0, 0), 0);
    assert.equal(deriveRefundShareBps(1000, 2000), 10000);
    assert.throws(() => deriveRefundShareBps(-1, 0));
  });

  test('recent store activity separates refunds and chargebacks', () => {
    const stores = buildRecentStoreEconomyActivity([
      entry(),
      entry({ id: 'payment:chargeback:pay-1', kind: 'payment_chargeback', amountMinor: -2950, occurredAt: '2026-08-29T11:00:00.000Z' }),
      entry({ id: 'payment:chargeback_reversal:pay-1', kind: 'payment_chargeback_reversal', amountMinor: 2950, occurredAt: '2026-08-29T11:30:00.000Z' }),
      entry({ id: 'payment:capture:pay-2', storeId: 'store-2', paymentId: 'pay-2', amountMinor: 5000, occurredAt: '2026-08-29T12:00:00.000Z' }),
    ]);
    assert.equal(stores.length, 2);
    assert.equal(stores[0]?.storeId, 'store-2');
    assert.deepEqual(stores.find(store => store.storeId === 'store-1'), {
      storeId: 'store-1',
      capturedMinor: 2950,
      refundedMinor: 0,
      grossAfterRefundsMinor: 2950,
      chargedBackMinor: 2950,
      chargebackReversedMinor: 2950,
      economicNetMinor: 2950,
      eventCount: 3,
      lastOccurredAt: '2026-08-29T11:30:00.000Z',
    });
  });

  test('recent allocation projection nets chargeback and reversal without recomputing policy', () => {
    const allocation = buildMarketplaceEconomicAllocationSnapshot({ subtotal: 30, discountTotal: 5, deliveryFee: 4.5, total: 29.5 });
    const projection = deriveRecentEconomicAllocationWindow([
      entry({ economicAllocation: allocation }),
      entry({ id: 'payment:chargeback:pay-1', kind: 'payment_chargeback', amountMinor: -2950, economicAllocation: allocation }),
      entry({ id: 'payment:chargeback_reversal:pay-1', kind: 'payment_chargeback_reversal', amountMinor: 2950, economicAllocation: allocation }),
    ]);
    assert.equal(projection.allocatedCaptureCount, 1);
    assert.equal(projection.allocatedRefundCount, 0);
    assert.equal(projection.allocatedChargebackCount, 1);
    assert.equal(projection.allocatedChargebackReversalCount, 1);
    assert.equal(projection.deliveryFeeMinor, 450);
    assert.equal(projection.courierRemunerationMinor, 450);
    assert.equal(projection.storeSubsidyMinor, 500);
  });

  test('lifetime allocation totals preserve immutable lifecycle snapshots', () => {
    const totals = combineEconomicAllocationLifecycleTotals({
      captures: allocationAggregate({
        count: 3,
        deliveryFeeMinor: 1200,
        courierRemunerationMinor: 1200,
        storeSubsidyMinor: 500,
        kyrubIncentiveMinor: 200,
        partnerSubsidyMinor: 100,
        observedCostsMinor: 90,
      }),
      refunds: allocationAggregate({
        count: 1,
        deliveryFeeMinor: 300,
        courierRemunerationMinor: 300,
        storeSubsidyMinor: 100,
        kyrubIncentiveMinor: 50,
        partnerSubsidyMinor: 25,
        observedCostsMinor: 20,
      }),
      chargebacks: allocationAggregate({
        count: 1,
        deliveryFeeMinor: 400,
        courierRemunerationMinor: 400,
        storeSubsidyMinor: 200,
        kyrubIncentiveMinor: 75,
        partnerSubsidyMinor: 30,
        observedCostsMinor: 25,
      }),
      chargebackReversals: allocationAggregate({
        count: 1,
        deliveryFeeMinor: 400,
        courierRemunerationMinor: 400,
        storeSubsidyMinor: 200,
        kyrubIncentiveMinor: 75,
        partnerSubsidyMinor: 30,
        observedCostsMinor: 25,
      }),
    });
    assert.deepEqual(totals, {
      allocatedCaptureCount: 3,
      allocatedRefundCount: 1,
      allocatedChargebackCount: 1,
      allocatedChargebackReversalCount: 1,
      deliveryFeeMinor: 900,
      courierRemunerationMinor: 900,
      storeSubsidyMinor: 400,
      kyrubIncentiveMinor: 150,
      partnerSubsidyMinor: 75,
      observedCostsMinor: 70,
    });
    assert.throws(() => combineEconomicAllocationLifecycleTotals({
      captures: allocationAggregate({ count: -1 }),
      refunds: allocationAggregate(),
      chargebacks: allocationAggregate(),
      chargebackReversals: allocationAggregate(),
    }));
  });

  test('backend aggregates capture, refund and chargeback lifecycle independently', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.match(service, /collectionGroup\('economicLedger'\)/);
    assert.match(service, /payment_chargeback/);
    assert.match(service, /payment_chargeback_reversal/);
    assert.match(service, /AggregateField\.sum\('amountMinor'\)/);
    assert.match(service, /chargebacks\.count\(\)\.get\(\)/);
    assert.match(service, /chargebackReversals\.count\(\)\.get\(\)/);
    assert.match(service, /economicNetMinor/);
    assert.match(service, /orderBy\('occurredAt', 'desc'\)/);
  });

  test('backend exposes lifetime delivery, subsidy, incentive and observed-cost allocation totals', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.match(service, /economicAllocation\.schemaVersion/);
    assert.match(service, /economicAllocation\.courierRemunerationMinor/);
    assert.match(service, /economicAllocation\.storeSubsidyMinor/);
    assert.match(service, /economicAllocation\.kyrubIncentiveMinor/);
    assert.match(service, /economicAllocation\.partnerSubsidyMinor/);
    assert.match(service, /economicAllocation\.observedCostsMinor/);
    assert.match(service, /combineEconomicAllocationLifecycleTotals/);
    assert.match(service, /allocationTotals/);
  });

  test('backend projects authoritative AI usage cost without mixing USD into BRL', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    const contract = readFileSync('shared/adminPlatformEconomy.ts', 'utf8');
    assert.match(service, /collection\('kyrub_usage_events'\)/);
    assert.match(service, /where\('resource', '==', 'ai'\)/);
    assert.match(service, /AggregateField\.sum\('estimatedCostMicrousd'\)/);
    assert.match(service, /AggregateField\.sum\('totalTokenCount'\)/);
    assert.match(service, /AI_CALL_CONSERVATION_INVALID/);
    assert.match(contract, /costCurrency: 'USD'/);
    assert.match(contract, /costUnit: 'microusd'/);
    assert.match(contract, /aiUsageTotals/);
    assert.doesNotMatch(service, /exchangeRate|usdToBrl|convertedCostMinor/i);
  });

  test('historical plan analysis can only use immutable ledger snapshots', () => {
    const ledger = readFileSync('shared/storeEconomicLedger.ts', 'utf8');
    const service = readFileSync('server/payments/storeEconomicLedgerService.ts', 'utf8');
    assert.match(ledger, /storePlan\?: KyrubCommercialPlanId/);
    assert.match(service, /parseStorePlan/);
    assert.match(service, /input\.event\.eventType === 'payment\.paid'/);
    assert.match(service, /captureSnapshot\.exists/);
    assert.match(service, /storeSnapshot/);
    assert.match(ledger, /input\.capture\.storePlan/);
    assert.match(ledger, /input\.chargeback\.storePlan/);
    assert.doesNotMatch(
      service,
      /buildRecoveredPaymentCaptureEconomicEntry\([\s\S]{0,300}storePlan/
    );
  });

  test('finance endpoint is server-authorized and audited', () => {
    const router = readFileSync('server/admin/platformEconomyRouter.ts', 'utf8');
    assert.match(router, /new Set\(\['super_admin', 'finance'\]\)/);
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /decoded\.emailVerified !== true/);
    assert.match(router, /clean\(profile\?\.status\) !== 'active'/);
    assert.match(router, /admin\.platform_economy\.viewed/);
    assert.match(router, /source: 'server'/);
    assert.match(router, /loadAuthorizedPlatformEconomySnapshot/);
    assert.match(router, /mapPlatformEconomyError/);
  });

  test('browser client only calls authenticated API and does not query Firestore', () => {
    const client = readFileSync('src/utils/adminPlatformEconomy.ts', 'utf8');
    assert.match(client, /user\.getIdToken\(\)/);
    assert.match(client, /\/api\/admin\/platform-economy/);
    assert.doesNotMatch(client, /firebase\/firestore|collectionGroup|collection\(db/);
  });

  test('Vercel rewrites platform economy into the existing admin function budget', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      rewrites?: Array<{ source?: string; destination?: string }>;
    };
    const transport = readFileSync('api/admin/operations/health.ts', 'utf8');
    const rewrite = config.rewrites?.find(
      candidate => candidate.source === '/api/admin/platform-economy'
    );
    assert.deepEqual(rewrite, {
      source: '/api/admin/platform-economy',
      destination: '/api/admin/operations/health?transport=platform-economy',
    });
    assert.match(transport, /transport === 'platform-economy'/);
    assert.match(transport, /loadAuthorizedPlatformEconomySnapshot/);
    assert.match(transport, /mapPlatformEconomyError/);
    assert.doesNotMatch(
      transport,
      /verifyFirebaseIdToken|collectionGroup\(|admin\.platform_economy\.viewed/
    );
  });

  test('workspace remains read-only and separate from settlement', () => {
    const workspace = readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx', 'utf8');
    assert.match(workspace, /hasAdminPermission\(profile, 'read_finance'\)/);
    assert.match(workspace, /Economia canônica da plataforma/);
    assert.doesNotMatch(workspace, /onClick=.*(settlement|transfer)/i);
  });

  test('control plane root mounts economy workspace without changing main admin app', () => {
    const root = readFileSync('src/components/admin/AdminControlPlaneRoot.tsx', 'utf8');
    assert.match(root, /<AdminPlatformEconomyWorkspace \/>/);
    assert.match(root, /id="admin-platform-economy"/);
    assert.match(root, /<AdminControlPlaneApp \/>/);
  });

  test('economic collection-group indexes include lifetime allocation dimensions', () => {
    const indexes = readFileSync('firestore.indexes.json', 'utf8');
    assert.match(indexes, /"collectionGroup": "economicLedger"/);
    assert.match(indexes, /"fieldPath": "kind"/);
    assert.match(indexes, /"fieldPath": "amountMinor"/);
    assert.match(indexes, /"fieldPath": "sourceAuthority"/);
    assert.match(indexes, /"fieldPath": "occurredAt"/);
    assert.match(indexes, /"fieldPath": "economicAllocation\.schemaVersion"/);
    assert.match(indexes, /"fieldPath": "economicAllocation\.courierRemunerationMinor"/);
    assert.match(indexes, /"fieldPath": "economicAllocation\.storeSubsidyMinor"/);
    assert.match(indexes, /"fieldPath": "economicAllocation\.kyrubIncentiveMinor"/);
    assert.match(indexes, /"fieldPath": "economicAllocation\.partnerSubsidyMinor"/);
    assert.match(indexes, /"fieldPath": "economicAllocation\.observedCostsMinor"/);
    assert.match(indexes, /"queryScope": "COLLECTION_GROUP"/);
  });

  test('admin projection stays separate from settlement and wallet balances', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    const contract = readFileSync('shared/adminPlatformEconomy.ts', 'utf8');
    const isolated = `${service}\n${contract}`;
    assert.match(isolated, /chargedBackMinor/);
    assert.match(isolated, /chargebackReversedMinor/);
    assert.doesNotMatch(isolated, /settlementMinor|walletBalance|splitMinor/);
  });

  test('server mounts the dedicated admin economy route', () => {
    const server = readFileSync('server.ts', 'utf8');
    assert.match(server, /"\/api\/admin\/platform-economy"/);
    assert.match(server, /createPlatformEconomyRouter\(\)/);
  });
});
