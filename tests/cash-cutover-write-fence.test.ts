import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isAuthorizedManagedCashMode } from '../server/attendance/cashRegisterSessionService';

const storeId = 'store-a';

test('managed Cash requires an explicit, well-formed server-owned cutover document', () => {
  const base = { mode: 'managed', storeId, schemaVersion: 1, cutoverOperationId: 'cutover-012345' };
  assert.equal(isAuthorizedManagedCashMode(base, storeId), true);
  for (const record of [
    undefined,
    null,
    {},
    { ...base, mode: 'legacy' },
    { ...base, mode: 'frozen' },
    { ...base, storeId: 'store-b' },
    { ...base, schemaVersion: 2 },
    { ...base, cutoverOperationId: '' },
  ]) {
    assert.equal(isAuthorizedManagedCashMode(record, storeId), false);
  }
});

test('each transaction that opens, moves or closes Cash requires managed coordination', () => {
  const service = readFileSync('server/attendance/cashRegisterSessionService.ts', 'utf8');
  const patterns = [
    /export const openCanonicalCashRegisterSession/,
    /export const addCanonicalCashRegisterMovement/,
    /export const closeCanonicalCashRegisterSession/,
  ];
  const boundaries = patterns.map(pattern => service.search(pattern));
  assert.ok(boundaries.every(i => i > -1));
  for (let i=0;i<boundaries.length;i++) {
    const segment = service.slice(boundaries[i], boundaries[i+1] ?? undefined);
    assert.match(segment, /await requireManagedCashMode\(transaction, actor\)/);
  }
  assert.match(service, /adminDb\.doc\(coordinationPath\(actor\.canonicalStoreId\)\)/);
  const router = readFileSync('server/attendance/cashRegisterRouter.ts', 'utf8');
  assert.match(router, /CASH_REGISTER_CUTOVER_NOT_ENABLED/);
  assert.match(router, /CASH_REGISTER_MANAGED_SESSIONS_ENABLED/);
});

test('Firestore rules gate every legacy write against server-only coordination state', () => {
  const ledger = readFileSync('firestore.cash-ledger.fragment.rules', 'utf8');
  const sessions = readFileSync('firestore.cash-sessions.fragment.rules', 'utf8');
  assert.match(ledger, /cashLedgerLegacyWritesPermitted/);
  assert.match(ledger, /cashCoordination\/current/);
  assert.match(ledger, /allow list, create, update, delete: if false/);
  assert.match(ledger, /cashLedgerLegacyWritesPermitted\(storeId\)/);
  assert.equal((sessions.match(/cashLedgerLegacyWritesPermitted\(storeId\)/g) || []).length, 2);
});
