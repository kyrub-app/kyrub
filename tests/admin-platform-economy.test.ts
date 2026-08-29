import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import {
  buildRecentStoreEconomyActivity,
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

describe('admin platform economy', () => {
  test('refund share is a bounded basis-point projection', () => {
    assert.equal(deriveRefundShareBps(10000, 2500), 2500);
    assert.equal(deriveRefundShareBps(0, 0), 0);
    assert.equal(deriveRefundShareBps(1000, 2000), 10000);
    assert.throws(() => deriveRefundShareBps(-1, 0));
  });

  test('recent store activity is explicitly derived only from recent entries', () => {
    const stores = buildRecentStoreEconomyActivity([
      entry(),
      entry({
        id: 'payment:refund:pay-1',
        kind: 'payment_refund',
        amountMinor: -2950,
        occurredAt: '2026-08-29T11:00:00.000Z',
      }),
      entry({
        id: 'payment:capture:pay-2',
        storeId: 'store-2',
        paymentId: 'pay-2',
        amountMinor: 5000,
        occurredAt: '2026-08-29T12:00:00.000Z',
      }),
    ]);
    assert.equal(stores.length, 2);
    assert.equal(stores[0]?.storeId, 'store-2');
    assert.deepEqual(
      stores.find(store => store.storeId === 'store-1'),
      {
        storeId: 'store-1',
        capturedMinor: 2950,
        refundedMinor: 2950,
        grossAfterRefundsMinor: 0,
        eventCount: 2,
        lastOccurredAt: '2026-08-29T11:00:00.000Z',
      }
    );
  });

  test('recent allocation projection nets refunds without recomputing policy', () => {
    const allocation = buildMarketplaceEconomicAllocationSnapshot({
      subtotal: 30,
      discountTotal: 5,
      deliveryFee: 4.5,
      total: 29.5,
    });
    const projection = deriveRecentEconomicAllocationWindow([
      entry({ economicAllocation: allocation }),
      entry({
        id: 'payment:refund:pay-1',
        kind: 'payment_refund',
        amountMinor: -2950,
        economicAllocation: allocation,
      }),
      entry({
        id: 'payment:capture:pay-2',
        paymentId: 'pay-2',
        amountMinor: 2950,
        economicAllocation: allocation,
      }),
    ]);

    assert.equal(projection.allocatedCaptureCount, 2);
    assert.equal(projection.allocatedRefundCount, 1);
    assert.equal(projection.deliveryFeeMinor, 450);
    assert.equal(projection.courierRemunerationMinor, 450);
    assert.equal(projection.storeSubsidyMinor, 500);
    assert.equal(projection.kyrubIncentiveMinor, 0);
    assert.equal(projection.partnerSubsidyMinor, 0);
  });

  test('backend uses collection-group aggregates for lifetime totals and a bounded recent window', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    assert.match(service, /collectionGroup\('economicLedger'\)/);
    assert.match(service, /AggregateField\.sum\('amountMinor'\)/);
    assert.match(service, /captures\.count\(\)\.get\(\)/);
    assert.match(service, /refunds\.count\(\)\.get\(\)/);
    assert.match(service, /orderBy\('occurredAt', 'desc'\)/);
    assert.match(service, /ADMIN_PLATFORM_ECONOMY_RECENT_LIMIT/);
    assert.match(service, /deriveRecentEconomicAllocationWindow/);
    assert.match(service, /recentWindow:/);
  });

  test('finance endpoint is server-authorized and audited', () => {
    const router = readFileSync('server/admin/platformEconomyRouter.ts', 'utf8');
    assert.match(router, /new Set\(\['super_admin', 'finance'\]\)/);
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /decoded\.emailVerified !== true/);
    assert.match(router, /clean\(profile\?\.status\) !== 'active'/);
    assert.match(router, /admin\.platform_economy\.viewed/);
    assert.match(router, /source: 'server'/);
  });

  test('browser client only calls authenticated API and does not query Firestore', () => {
    const client = readFileSync('src/utils/adminPlatformEconomy.ts', 'utf8');
    assert.match(client, /user\.getIdToken\(\)/);
    assert.match(client, /\/api\/admin\/platform-economy/);
    assert.doesNotMatch(client, /firebase\/firestore|collectionGroup|collection\(db/);
  });

  test('workspace is gated by read_finance and does not expose settlement actions', () => {
    const workspace = readFileSync(
      'src/components/admin/AdminPlatformEconomyWorkspace.tsx',
      'utf8'
    );
    assert.match(workspace, /hasAdminPermission\(profile, 'read_finance'\)/);
    assert.match(workspace, /Economia canônica da plataforma/);
    assert.match(workspace, /não é ranking vitalício/);
    assert.doesNotMatch(workspace, /onClick=.*(settlement|transfer)/i);
  });

  test('control plane root mounts economy workspace without changing main admin app', () => {
    const root = readFileSync('src/components/admin/AdminControlPlaneRoot.tsx', 'utf8');
    assert.match(root, /<AdminPlatformEconomyWorkspace \/>/);
    assert.match(root, /id="admin-platform-economy"/);
    assert.match(root, /<AdminControlPlaneApp \/>/);
  });

  test('economic collection-group indexes are explicit', () => {
    const indexes = readFileSync('firestore.indexes.json', 'utf8');
    assert.match(indexes, /"collectionGroup": "economicLedger"/);
    assert.match(indexes, /"fieldPath": "kind"/);
    assert.match(indexes, /"fieldPath": "amountMinor"/);
    assert.match(indexes, /"fieldPath": "sourceAuthority"/);
    assert.match(indexes, /"fieldPath": "occurredAt"/);
    assert.match(indexes, /"queryScope": "COLLECTION_GROUP"/);
  });

  test('admin projection reads persisted allocations but does not create settlement or wallet balances', () => {
    const service = readFileSync('server/admin/platformEconomyService.ts', 'utf8');
    const contract = readFileSync('shared/adminPlatformEconomy.ts', 'utf8');
    const isolated = `${service}\n${contract}`;
    assert.match(isolated, /storeSubsidyMinor/);
    assert.match(isolated, /kyrubIncentiveMinor/);
    assert.match(isolated, /partnerSubsidyMinor/);
    assert.doesNotMatch(isolated, /settlementMinor|walletBalance|taxMinor|splitMinor/);
  });

  test('server mounts the dedicated admin economy route', () => {
    const server = readFileSync('server.ts', 'utf8');
    assert.match(server, /"\/api\/admin\/platform-economy"/);
    assert.match(server, /createPlatformEconomyRouter\(\)/);
  });
});
