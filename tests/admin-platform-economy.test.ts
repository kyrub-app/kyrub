import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { projectPlatformFinops, FINOPS_CATEGORIES, type FinopsFact, type FinopsPeriod, type FinopsCoverage } from '../shared/platformFinops';
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

  test('existing finance workspace is mounted once inside the authorized accordion', () => {
    const root = readFileSync('src/components/admin/AdminControlPlaneRoot.tsx', 'utf8');
    const app = readFileSync('src/components/admin/AdminControlPlaneApp.tsx', 'utf8');
    const accordion = readFileSync('src/components/admin/AdminAccordionSection.tsx', 'utf8');
    assert.doesNotMatch(root, /AdminPlatformEconomyWorkspace/);
    assert.match(root, /<AdminControlPlaneApp \/>/);
    assert.match(app, /hasAdminPermission\(profile, 'read_finance'\) && <AdminAccordionSection[^>]+id="admin-platform-economy"/);
    assert.match(app, /<PlatformEconomy user=\{user\} profile=\{profile\}\/>/);
    assert.match(accordion, /\{open &&/);
  });

  test('finance workspace separates ecosystem movement from unmeasured own economics and cancels stale requests', () => {
    const workspace = readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx', 'utf8');
    const client = readFileSync('src/utils/adminPlatformEconomy.ts', 'utf8');
    assert.match(workspace, /Não consolidado/);
    assert.match(workspace, /não equivalem a receita própria, lucro/);
    assert.match(workspace, /sem recorte mensal/);
    assert.match(workspace, /auth\.currentUser === user/);
    assert.match(workspace, /request\.current\?\.abort\(\)/);
    assert.match(workspace, /if \(current\(\)\) setSnapshot\(next\)/);
    assert.match(client, /signal,/);
    assert.doesNotMatch(workspace, /onAuthStateChanged|subscribeToAdminProfile/);
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

describe('platform own financial period projection', () => {
  const period: FinopsPeriod = {month:'2026-11', timezone:'America/Sao_Paulo', basis:'cash', currency:'BRL'};
  const fact = (overrides: Partial<FinopsFact> = {}): FinopsFact => ({
    period, category:'vercel', factId:'invoice-line-1', sourceRef:'invoice-1',
    amountMinor:12000, quality:'confirmed', originalCurrency:'BRL', ...overrides,
  });
  const complete: FinopsCoverage[] = FINOPS_CATEGORIES.map(category => ({
    period, category, status:'complete', evidenceRef:'reconciled-' + category,
  }));
  const users = {period, uniqueAuthenticatedUsers:1000, status:'complete' as const, evidenceRef:'unique-active-users'};
  test('missing data is unavailable, not zero; partial invoices do not produce a total or cost per user', () => {
    const empty = projectPlatformFinops(period, [], []);
    assert.equal(empty.costs.confirmedMinor, null);
    assert.equal(empty.costs.status, 'unavailable');
    assert.equal(empty.resultMinor, null);
    const partial = projectPlatformFinops(period, [fact()], [], users);
    assert.equal(partial.costs.confirmedMinor, 12000);
    assert.equal(partial.costs.status, 'partial');
    assert.equal(partial.costPerActiveUserMinor, null);
    assert.equal(partial.resultMinor, null);
  });
  test('complete reconciled evidence supports period totals and signed reversals without counting marketplace GMV', () => {
    const result = projectPlatformFinops(period, [
      fact(), fact({factId:'plan-1', category:'plans', amountMinor:19700}),
      fact({factId:'plan-refund-1', category:'plans', amountMinor:-1000}),
    ], complete, users);
    assert.equal(result.costs.confirmedMinor, 12000);
    assert.equal(result.revenue.confirmedMinor, 18700);
    assert.equal(result.resultMinor, 6700);
    assert.equal(result.marginBps, 3583);
    assert.equal(result.costPerActiveUserMinor, 12);
    assert.equal(result.revenuePerActiveUserMinor, 19);
    assert.equal(result.categories.ads.confirmedMinor, 0);
    assert.equal(projectPlatformFinops(period, [], complete, {...users, uniqueAuthenticatedUsers:0}).costPerActiveUserMinor, null);
    assert.equal(projectPlatformFinops(period, [], complete, {...users, status:'partial'}).costPerActiveUserMinor, null);
  });
  test('estimates remain separate even if coverage is marked complete', () => {
    const result = projectPlatformFinops(period, [fact(), fact({
      factId:'estimated-1', category:'firebase_gcp', amountMinor:5000, quality:'estimated',
    })], complete, users);
    assert.equal(result.costs.status, 'partial');
    assert.equal(result.costs.confirmedMinor, 12000);
    assert.equal(result.costs.estimatedMinor, 5000);
    assert.equal(result.resultMinor, null);
    assert.equal(result.costPerActiveUserMinor, null);
  });
  test('rejects duplicates, out-of-period facts, mixed accounting bases and unproven FX', () => {
    assert.throws(() => projectPlatformFinops(period, [fact(), fact({category:'providers'})], []), /DUPLICATE_FACT/);
    assert.throws(() => projectPlatformFinops(period, [fact({period:{...period, month:'2026-10'}})], []), /FACT_INVALID/);
    assert.throws(() => projectPlatformFinops(period, [fact({period:{...period, basis:'accrual'}})], []), /FACT_INVALID/);
    assert.throws(() => projectPlatformFinops(period, [fact({originalCurrency:'USD'})], []), /FACT_INVALID/);
    assert.throws(() => projectPlatformFinops(period, [fact({category:'merchant_gmv' as FinopsFact['category']})], []), /FACT_INVALID/);
    assert.throws(() => projectPlatformFinops(period, [], [complete[0], complete[0]]), /DUPLICATE_COVERAGE/);
    assert.throws(() => projectPlatformFinops(period, [], complete, {...users, period:{...period, month:'2026-10'}}), /ACTIVE_USERS_INVALID/);
  });
});
