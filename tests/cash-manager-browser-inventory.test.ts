import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  aggregateCashDeviceInspections,
  requireCashInventoryManagerRole,
  type CashDeviceInspectionRow,
} from '../server/attendance/cashDeviceInspectionInventory';

const counts = (currentActorPending: number, otherActorsPending=0, localOpenSessions=0) => ({
  currentActorPending, otherActorsPending, unattributedPending: 0,
  localOpenSessions,
  pendingOpeningOperations: currentActorPending + otherActorsPending,
  pendingMovementOperations: 0, pendingClosingOperations: 0,
});
const record = (
  id:string, deviceKey:string, actorUserId:string,
  reportedAtMs:number, currentActorPending:number, otherActorsPending=0
): CashDeviceInspectionRow => ({
  id, deviceKey, actorUserId, reportedAtMs,
  counts: counts(currentActorPending, otherActorsPending),
});

test('BYOD inventory discovers only submitted browsers, never required unreported phones', () => {
  const result = aggregateCashDeviceInspections([]);
  assert.equal(result.observedBrowsers, 0);
  assert.equal(result.reportingCollaborators, 0);
  assert.equal(result.discovery, 'submitted-reports-only');
  assert.equal(result.allBrowsersKnown, false);
  assert.equal(result.cutoverApproved, false);
});

test('two collaborators reporting the same browser create ONE browser record', () => {
  const report = aggregateCashDeviceInspections([
    record('report-a', 'browser-same', 'ana', 1000, 2, 1),
    record('report-b', 'browser-same', 'bruno', 2000, 0, 0),
    record('report-c', 'browser-other', 'carla', 3000, 1),
  ]);
  assert.equal(report.observedBrowsers, 2);
  assert.equal(report.reportingCollaborators, 3);
  assert.equal(report.withReportedPending, 1);
  assert.equal(report.withoutReportedPending, 1);
  assert.equal(report.browsers.find(b=>b.browserKey==='browser-same')?.reporterCount, 2);
  // One browser = latest queue snapshot. The previous 3 pending operations
  // must not be added again to the newer 0-pending report.
  assert.equal(report.browsers.find(b=>b.browserKey==='browser-same')?.pendingOperations, 0);
  assert.equal(report.cutoverApproved, false);
});

test('older actor-scoped reports with no browser key are retained without invented matches', () => {
  const report = aggregateCashDeviceInspections([
    record('old-a', '', 'ana', 1000, 0),
    record('old-b', '', 'bruno', 1000, 0),
  ]);
  assert.equal(report.observedBrowsers, 2);
  assert.equal(report.legacyUnlinkedReports, 2);
  assert.equal(report.allBrowsersKnown, false);
});

test('only owner or manager can receive the inventory', () => {
  assert.doesNotThrow(()=>requireCashInventoryManagerRole('owner'));
  assert.doesNotThrow(()=>requireCashInventoryManagerRole('manager'));
  for(const role of ['cashier','seller','production','', 'admin'])
    assert.throws(()=>requireCashInventoryManagerRole(role), /CASH_REGISTER_FORBIDDEN/);
});

test('finance embeds device inventory into existing Cash operational projection', () => {
  const router = readFileSync('server/attendance/cashRegisterRouter.ts', 'utf8');
  const service = readFileSync('server/attendance/cashRegisterSessionService.ts', 'utf8');
  const cash = readFileSync('src/components/store/StoreCashFinanceWorkspace.tsx', 'utf8');
  const finance = readFileSync('src/components/StoreFinanceRuntime.tsx', 'utf8');
  const ui = readFileSync('src/components/store/StoreCashDeviceInventory.tsx', 'utf8');
  assert.ok(router.indexOf("router.get('/device-inspections'") < router.indexOf('router.use((_request, response, next)'));
  assert.match(service, /requireCashInventoryManagerRole\(actor.role\)/);
  assert.match(service, /await adminDb.runTransaction\(transaction => requireTransactionActor/);
  assert.match(service, /\.limit\(101\)\.get\(\)/);
  assert.match(service, /CASH_REGISTER_INSPECTION_SCAN_INCOMPLETE/);
  const listing = service.slice(
    service.indexOf('export const listCashDeviceInspectionInventory'),
    service.indexOf('export const normalizedCashRegisterName')
  );
  assert.match(router, /legacyStoreId: clean\\(request.query.storeId\\)/);
  assert.match(listing, /legacyStoreId: string/);
  assert.match(listing, /const actor = await authorizeRegisterActor/);
  assert.match(listing, /const storeId = actor.canonicalStoreId/);
  assert.doesNotMatch(listing, /input.canonicalStoreId/);
  const composite = readFileSync('src/components/StoreFinanceCompositeRuntime.tsx', 'utf8');
  assert.ok(composite.includes('<StoreCashDeviceInventory storeId={storeId} />'));
  assert.ok(composite.includes('Caixa operacional'));
  assert.doesNotMatch(cash, /StoreCashDeviceInventory/);
  assert.ok(finance.includes('<StoreCashFinanceWorkspace projection={cash} />'));
  assert.match(ui, /data-kyrub-cash-manager-inventory="submitted-only"/);
  assert.doesNotMatch(ui, /[Ll]iberar migração|[Aa]provar migração/);
});
