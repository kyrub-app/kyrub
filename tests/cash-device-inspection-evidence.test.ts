import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateCashDeviceInspectionCounts } from '../server/attendance/cashRegisterSessionService';

const valid = {
  currentActorPending: 1, otherActorsPending: 2, unattributedPending: 1,
  localOpenSessions: 1, pendingOpeningOperations: 2,
  pendingMovementOperations: 1, pendingClosingOperations: 1,
};

test('self-reported browser counts are normalized and internally consistent', () => {
  assert.deepEqual(validateCashDeviceInspectionCounts(valid), valid);
  for (const invalid of [
    null, {}, { ...valid, currentActorPending: -1 },
    { ...valid, currentActorPending: 0.1 },
    { ...valid, currentActorPending: 999999999 },
    { ...valid, pendingMovementOperations: 0 },
    { ...valid, pendingClosingOperations: undefined },
  ]) assert.throws(
    () => validateCashDeviceInspectionCounts(invalid),
    /CASH_REGISTER_INSPECTION_INVALID/
  );
});

test('inspection endpoints are authenticated, never enable Cash managed mode', () => {
  const router = readFileSync('server/attendance/cashRegisterRouter.ts', 'utf8');
  const service = readFileSync('server/attendance/cashRegisterSessionService.ts', 'utf8');
  const client = readFileSync('src/utils/canonicalCash.ts', 'utf8');
  const ui = readFileSync('src/components/store/CashWorkspace.tsx', 'utf8');
  assert.ok(router.indexOf("router.post('/device-inspections'") <
    router.indexOf('router.use((_request, response, next)'));
  assert.match(router, /await requireActorId\(request\.get\('authorization'\)/);
  assert.match(service, /await requireTransactionActor\(transaction, actor\)/);
  assert.match(service, /selfReported: true/);
  assert.match(service, /activationAllowed: false/);
  assert.match(service, /cashDeviceInspections/);
  assert.doesNotMatch(service.slice(service.indexOf('export const recordCashDeviceInspection'), service.indexOf('export const normalizedCashRegisterName')), /transaction\.(?:update|create|set)\(.*coordinationPath/);
  assert.match(client, /getCashLocalQueueAudit\(context\)/);
  assert.match(ui, /data-kyrub-cash-inspection="self-report"/);
  assert.match(ui, /crypto\.randomUUID\(\)/);
});
