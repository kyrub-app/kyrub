import { loadInfrastructureDiagnostic } from '../server/admin/infrastructureDiagnostic';
import { presentInfrastructureDiagnostic } from '../src/utils/adminInfrastructurePresentation';
import { projectPlatformInfrastructure } from '../shared/platformFinops';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { evaluateMonthlyMarkerRetention, type MonthlyRetentionEvidence } from '../server/observability/monthlyPresenceRetention';
import { loadMonthlyActivityDiagnostic } from '../server/admin/monthlyActivityDiagnostic';
import { presentMonthlyActivity } from '../src/utils/adminMonthlyActivityPresentation';
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
    assert.match(router, /verify:verifyFirebaseIdToken/);
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

test('monthly activity diagnostic is unavailable without isolated emulator configuration', async () => {
  const now = new Date('2026-12-01T02:59:59Z');
  let calls = 0;
  const env = {KYRUB_FINOPS_MAU_EMULATOR_ENABLED:'true', FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',
    FIREBASE_PROJECT_ID:'kyrub-security-test', KYRUB_FINOPS_MAU_EMULATOR_KEY:'ab'.repeat(32)};
  const deps = {env, currentProject:()=> 'kyrub-security-test', count:async(month:string)=>{
    assert.equal(month,'2026-11'); calls++; return 2;
  }};
  for (const change of [{env:{}},{env:{...env,VERCEL_ENV:'production'}},{currentProject:()=> 'kyrub-b8d0e'}]) {
    const result = await loadMonthlyActivityDiagnostic(now,{...deps,...change});
    assert.deepEqual(result,{month:'2026-11',scope:'emulator_only',status:'unavailable',observedMarkers:null,realMau:null});
  }
  assert.equal(calls,0);
  assert.deepEqual(await loadMonthlyActivityDiagnostic(now,deps),{month:'2026-11',scope:'emulator_only',status:'fixture_count',observedMarkers:2,realMau:null});
  assert.equal(calls,1);
  assert.equal((await loadMonthlyActivityDiagnostic(now,{...deps,count:async()=>0})).realMau,null);
  assert.equal((await loadMonthlyActivityDiagnostic(now,{...deps,count:async()=>-1})).status,'unavailable');
  assert.equal((await loadMonthlyActivityDiagnostic(now,{...deps,count:async()=>{throw Error('offline');}})).observedMarkers,null);
});
test('monthly aggregate remains behind the existing server finance authorization and audit', () => {
  const router = readFileSync('server/admin/platformEconomyRouter.ts','utf8');
  const diagnostic = readFileSync('server/admin/monthlyActivityDiagnostic.ts','utf8');
  assert.match(router,/const admin = await authorizePlatformEconomy\(authorization\);[\s\S]*?loadMonthlyActivityDiagnostic\(\);[\s\S]*?await recordPlatformEconomyAudit\(admin\)/);
  assert.match(diagnostic,/\.count\(\)\.get\(\)/);
  assert.doesNotMatch(diagnostic,/snapshot\.docs|\.listDocuments\(/);
});

test('finance presentation never promotes fixture counts or missing data to real MAU', () => {
  const fixture={month:'2026-11',scope:'emulator_only',status:'fixture_count',observedMarkers:5,realMau:null};
  assert.deepEqual(presentMonthlyActivity(fixture),{month:'2026-11',fixtureCount:5});
  assert.equal(presentMonthlyActivity({...fixture,observedMarkers:0}).fixtureCount,0);
  for(const value of [undefined,null,{...fixture,status:'unavailable',observedMarkers:null},
    {...fixture,scope:'production'},{...fixture,realMau:5},{...fixture,observedMarkers:-1},
    {...fixture,month:'2026-13'},{...fixture,observedMarkers:5.5}]) {
    assert.equal(presentMonthlyActivity(value).fixtureCount,null);
  }
  const workspace=readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx','utf8');
  assert.match(workspace,/MAU real indisponível/);
  assert.match(workspace,/Registros de teste — emulador/);
  assert.match(workspace,/presentMonthlyActivity\(snapshot\?\.monthlyActivity\)/);
  assert.doesNotMatch(workspace,/projectPlatformFinops\(/);
});

describe('monthly activity retention planning', () => {
  const e: MonthlyRetentionEvidence = {
    projectId:'kyrub-security-test',scope:'emulator',month:'2026-11',
    governance:{policyApproved:true,legalHold:false,pendingRightsRequest:false,evidenceRef:'policy-fixture'},
    writerFence:{projectId:'kyrub-security-test',month:'2026-11',evidenceRef:'seal-fixture',sealedAtMs:Date.parse('2026-12-01T04:00:00Z')},
    summary:{projectId:'kyrub-security-test',scope:'emulator',month:'2026-11',coverage:'complete',
      observedMarkers:1000,evidenceRef:'summary-fixture',fenceRef:'seal-fixture',persistedAtMs:Date.parse('2026-12-02T04:00:00Z')},
    verifiedCount:{projectId:'kyrub-security-test',month:'2026-11',count:1000,fenceRef:'seal-fixture',observedAtMs:Date.parse('2027-03-01T03:00:00Z')},
  };
  const now=new Date('2027-03-01T03:00:01Z');
  const plan=(x:MonthlyRetentionEvidence)=>evaluateMonthlyMarkerRetention(x,'kyrub-security-test','emulator',now);
  test('retains the activity month plus three full Sao Paulo calendar months',()=>{
    assert.deepEqual(evaluateMonthlyMarkerRetention(e,'kyrub-security-test','emulator',new Date('2027-03-01T02:59:59Z')),
      {status:'retain',reason:'GRACE_WINDOW',month:'2026-11',earliestReviewMonth:'2027-03'});
    assert.equal(plan(e).status,'review_candidate');
    assert.equal(plan({...e,month:'2027-03'}).status,'retain');
    assert.equal(plan({...e,month:'2026-13'}).status,'blocked');
  });
  test('fails closed on missing governance, hold, request, seal, summary or count mismatch',()=>{
    for(const changed of [
      {...e,governance:undefined},
      {...e,governance:{...e.governance!,policyApproved:false}},
      {...e,governance:{...e.governance!,legalHold:true}},
      {...e,governance:{...e.governance!,pendingRightsRequest:true}},
      {...e,writerFence:undefined},
      {...e,writerFence:{...e.writerFence!,sealedAtMs:Date.parse('2026-11-30T22:00:00Z')}},
      {...e,summary:undefined},
      {...e,summary:{...e.summary!,coverage:'partial' as const}},
      {...e,summary:{...e.summary!,scope:'production' as const}},
      {...e,summary:{...e.summary!,fenceRef:'other'}},
      {...e,verifiedCount:undefined},
      {...e,verifiedCount:{...e.verifiedCount!,count:999}},
      {...e,verifiedCount:{...e.verifiedCount!,observedAtMs:0}},
      {...e,verifiedCount:{...e.verifiedCount!,observedAtMs:now.getTime()+1}},
      {...e,projectId:'other'},
    ]) assert.equal(plan(changed).status,'blocked');
  });
  test('only an explicit reconciled zero can qualify; no deletion runtime exists',()=>{
    const zero={...e,summary:{...e.summary!,observedMarkers:0},verifiedCount:{...e.verifiedCount!,count:0}};
    assert.equal(plan(zero).status,'review_candidate');
    const code=readFileSync('server/observability/monthlyPresenceRetention.ts','utf8');
    assert.doesNotMatch(code,/adminDb|\.delete\(|\.set\(|\.update\(|process\.env/);
  });
});

test('control plane keeps ecosystem economics and sustainability, not a duplicate company finance', () => {
  const workspace=readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx','utf8');
  const modules=readFileSync('src/components/admin/AdminModulesWorkspace.tsx','utf8');
  const erp=readFileSync('src/components/StoreFinanceCompositeRuntime.tsx','utf8');
  const subscriptions=readFileSync('src/components/store/StoreSubscriptionsWorkspace.tsx','utf8');
  assert.match(workspace,/Custo de infraestrutura/);
  assert.match(workspace,/Custo de infraestrutura por usuário ativo/);
  assert.doesNotMatch(workspace,/\['Custos de operação da plataforma'|\['Custo por usuário ativo'|\['Custo operacional total'/);
  assert.match(workspace,/Gestão empresarial .*ERP da Loja Oficial Kyrub/);
  assert.doesNotMatch(workspace,/\['Receitas próprias Kyrub'|\['Resultado e custo por usuário ativo'/);
  assert.match(modules,/Gestão empresarial e lançamentos financeiros pertencem ao ERP da Loja Oficial/);
  assert.match(erp,/<StoreFinancePeriodRuntime/);
  assert.match(erp,/<StoreResultsMarginsWorkspace/);
  assert.match(erp,/<StoreFinanceRuntime/);
  assert.match(subscriptions,/activeSubscriberCount/);
});

test('FinOps technology cost is a subset of own operating cost, independently covered',()=>{
  const period:FinopsPeriod={month:'2026-11',timezone:'America/Sao_Paulo',basis:'cash',currency:'BRL'};
  const coverage=FINOPS_CATEGORIES.map(category=>({period,category,status:'complete' as const,evidenceRef:'fixture-coverage-'+category}));
  const fact=(category:FinopsFact['category'],amountMinor:number):FinopsFact=>({period,category,amountMinor,factId:'fixture-'+category,sourceRef:'erp-fixture-'+category,quality:'confirmed',originalCurrency:'BRL'});
  const facts=[fact('firebase_gcp',90000),fact('vercel',30000),fact('operations',160000),fact('tag_costs',80000),fact('payment_fees',40000)];
  const users={period,uniqueAuthenticatedUsers:10000,status:'complete' as const,evidenceRef:'mau-fixture'};
  const full=projectPlatformFinops(period,facts,coverage,users);
  assert.equal(full.costs.confirmedMinor,400000);
  assert.equal(full.technologyCosts.confirmedMinor,120000);
  assert.equal(full.costPerActiveUserMinor,40);
  assert.equal(full.technologyCostPerActiveUserMinor,12);
  const onlyTechnology=coverage.filter(x=>['firebase_gcp','vercel','other_infrastructure'].includes(x.category));
  const partial=projectPlatformFinops(period,facts,onlyTechnology,users);
  assert.equal(partial.costs.status,'partial');
  assert.equal(partial.costPerActiveUserMinor,null);
  assert.equal(partial.technologyCostPerActiveUserMinor,12);
  const missingTechnology=projectPlatformFinops(period,facts,coverage.filter(x=>x.category!=='other_infrastructure'),users);
  assert.equal(missingTechnology.technologyCostPerActiveUserMinor,null);
  assert.equal(missingTechnology.costPerActiveUserMinor,null);
  assert.equal(projectPlatformFinops(period,facts,coverage,{...users,status:'partial'}).technologyCostPerActiveUserMinor,null);
  assert.equal(projectPlatformFinops(period,facts,coverage,{...users,uniqueAuthenticatedUsers:0}).technologyCostPerActiveUserMinor,null);
  const withEstimate=projectPlatformFinops(period,[...facts,{...fact('other_infrastructure',5000),quality:'estimated'}],coverage,users);
  assert.equal(withEstimate.technologyCosts.estimatedMinor,5000);
  assert.equal(withEstimate.technologyCostPerActiveUserMinor,null);
  assert.throws(()=>projectPlatformFinops(period,[...facts,{...facts[0],category:'operations'}],coverage,users),/DUPLICATE_FACT/);
});

test('restricted infrastructure projection excludes all company finance metrics and source identities',()=>{
  const period:FinopsPeriod={month:'2026-11',timezone:'America/Sao_Paulo',basis:'cash',currency:'BRL'};
  const coverage=FINOPS_CATEGORIES.map(category=>({period,category,status:'complete' as const,evidenceRef:'fixture-'+category}));
  const fact=(category:FinopsFact['category'],amountMinor:number):FinopsFact=>({period,category,amountMinor,factId:'fixture-'+category,sourceRef:'erp-fixture-'+category,quality:'confirmed',originalCurrency:'BRL'});
  const users={period,uniqueAuthenticatedUsers:10000,status:'complete' as const,evidenceRef:'mau-fixture'};
  const result=projectPlatformInfrastructure(period,[fact('firebase_gcp',90000),fact('vercel',30000),fact('operations',280000),fact('plans',1970000)],coverage,users);
  assert.deepEqual(result,{period,infrastructureCosts:{status:'complete',confirmedMinor:120000,estimatedMinor:null},mau:10000,infrastructureCostPerActiveUserMinor:12});
  assert.equal(projectPlatformInfrastructure(period,[],[],users).infrastructureCostPerActiveUserMinor,null);
});

test('official infrastructure fixture reader is reachable only through gated diagnostic and cannot mutate ERP',()=>{
  const reader=readFileSync('server/admin/officialInfrastructureFixtureReader.ts','utf8');
  const router=readFileSync('server/admin/platformEconomyRouter.ts','utf8');
  assert.match(reader,/await authorizePlatformEconomy\(authorization/);
  assert.match(reader,/kyrub_admin\/official_store/);
  assert.match(reader,/getPrimaryUserStoreDocumentPath\(d.legacyStoreId\)/);
  assert.match(reader,/privateStore.get\('canonicalStoreId'\)!==d.canonicalStoreId/);
  assert.match(reader,/return d.legacyStoreId/);
  assert.match(reader,/\{readOnly:true\}/);
  assert.match(reader,/raw.costCenter\?\.id!==INFRASTRUCTURE_COST_CENTER_ID/);
  assert.match(reader,/readOfficialRegisteredInfrastructureFixture/);
  assert.doesNotMatch(reader,/\btx\.(set|create|update|delete)\(|recoverAllMissingCanonicalPaidCaptures/);
  assert.doesNotMatch(router,/readOfficialInfrastructureFixture|readOfficialRegisteredInfrastructureFixture/);
  assert.match(router,/const admin = await authorizePlatformEconomy\(authorization\);[\s\S]*?loadInfrastructureDiagnostic\(authorization,monthlyActivity.month\);[\s\S]*?await recordPlatformEconomyAudit\(admin\)/);
});

test('infrastructure diagnostic never reads remote ERP and returns only explicit fixture fields',async()=>{
  const month='2026-11';
  const env={KYRUB_FINOPS_INFRASTRUCTURE_EMULATOR_ENABLED:'true',FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088',FIREBASE_PROJECT_ID:'kyrub-security-test'};
  let calls=0;
  const fixture={month,timeZone:'America/Sao_Paulo' as const,basis:'cash' as const,scope:'emulator_only' as const,status:'fixture_partial' as const,registeredPaidMinor:120000,matchedCount:1,actualInfrastructureCostMinor:null,realMau:null};
  const deps={env,currentProject:()=> 'kyrub-security-test',read:async(auth:string,m:string)=>{assert.equal(auth,'Bearer fixture');assert.equal(m,month);calls++;return {...fixture,privateRef:'not exposed'};}};
  for(const change of [{env:{}},{env:{...env,NODE_ENV:'production'}},{env:{...env,VERCEL_ENV:'production'}},{env:{...env,FIRESTORE_EMULATOR_HOST:'remote:8088'}},{env:{...env,FIREBASE_SERVICE_ACCOUNT_JSON:'present'}},{currentProject:()=> 'kyrub-b8d0e'}]){
    assert.equal((await loadInfrastructureDiagnostic('Bearer fixture',month,{...deps,...change})).registeredPaidMinor,null);
  }
  assert.equal(calls,0);
  assert.deepEqual(await loadInfrastructureDiagnostic('Bearer fixture',month,deps),fixture);
  assert.equal(calls,1);
  assert.equal((await loadInfrastructureDiagnostic('Bearer fixture',month,{...deps,read:async()=>{throw Error('offline');}})).status,'unavailable');
  assert.deepEqual(presentInfrastructureDiagnostic(fixture,month),{month,fixturePaidMinor:120000,fixtureCount:1});
  for(const bad of [null,{...fixture,actualInfrastructureCostMinor:120000},{...fixture,realMau:1},{...fixture,scope:'production'},{...fixture,registeredPaidMinor:0},{...fixture,matchedCount:501},{...fixture,month:'2026-10'}]){
    assert.equal(presentInfrastructureDiagnostic(bad,month).fixturePaidMinor,null);
  }
  const workspace=readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx','utf8');
  assert.match(workspace,/Infraestrutura — registros de teste no emulador/);
  assert.match(workspace,/Não consolidado/);
  assert.match(workspace,/MAU real indisponível/);
  assert.doesNotMatch(workspace,/fixturePaidMinor\s*\//);
});


test('Control Plane configured efficiency is tied to runtime polling, never presented as measured usage or savings',async()=>{
 const {notificationPollInterval,projectNotificationPollingPolicy}=await import('../shared/platformEfficiencyPolicy');
 assert.equal(notificationPollInterval(false,false),15000);
 assert.equal(notificationPollInterval(false,true),15000);
 assert.equal(notificationPollInterval(true,true),15000);
 assert.equal(notificationPollInterval(true,false),60000);
 assert.deepEqual(projectNotificationPollingPolicy(),{foregroundPerHour:240,hiddenWithoutAlertsPerHour:60,basis:'configured_interval'});
 const ui=readFileSync('src/components/admin/AdminPlatformEconomyWorkspace.tsx','utf8');
 assert.match(ui,/projectNotificationPollingPolicy\(\)/);
 assert.match(ui,/Não são medições de uso, faturas ou economia financeira comprovada/);
 assert.match(ui,/Não medidos/);
});
