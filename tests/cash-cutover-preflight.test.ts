import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assessCashCutoverPreflight,
  type CutoverCashDocument,
} from '../server/attendance/cashRegisterCutoverReadiness';

const storeId = 'store-a';
const document = (
  id: string,
  data: Record<string, unknown>
): CutoverCashDocument => ({ id, data: { id, storeId, ...data } });

const register = (id: string, activeSessionId = '') => document(id, {
  status: 'active',
  activeSessionId,
});

const managedSession = (id: string, registerId: string) => document(id, {
  status: 'open',
  deviceId: 'server-managed-register',
  registerId,
});

const legacySession = (id: string) => document(id, {
  status: 'open',
  deviceId: 'device-legacy',
  migration: { mode: 'write_through', source: 'dexie' },
});

const audit = (overrides: Partial<Parameters<typeof assessCashCutoverPreflight>[0]> = {}) =>
  assessCashCutoverPreflight({
    canonicalStoreId: storeId,
    openSessions: [],
    registers: [register('register-a')],
    openSessionLimitReached: false,
    registerLimitReached: false,
    ...overrides,
  });

test('remote preflight can be clear but NEVER authorizes automatic cutover', () => {
  const result = audit();
  assert.equal(result.remotePreflightClear, true);
  assert.equal(result.assessmentOnly, true);
  assert.equal(result.activationAllowed, false);
  assert.equal(result.offlineDeviceQueuesVerified, false);
});

test('open legacy sessions block cutover regardless of any terminal mapping', () => {
  const result = audit({ openSessions: [legacySession('legacy-1')] });
  assert.equal(result.openLegacySessions, 1);
  assert.equal(result.remotePreflightClear, false);
  assert.ok(result.blockers.includes('LEGACY_SESSION_OPEN'));
});

test('different valid registers may be open simultaneously, but still require cutover review', () => {
  const result = audit({
    registers: [register('register-a', 'managed-a'), register('register-b', 'managed-b')],
    openSessions: [managedSession('managed-a', 'register-a'), managedSession('managed-b', 'register-b')],
  });
  assert.equal(result.openManagedSessions, 2);
  assert.equal(result.blockers.includes('MULTIPLE_OPEN_SESSIONS_PER_REGISTER'), false);
  assert.equal(result.activationAllowed, false);
});

test('multiple sessions in the same terminal and stale pointers block cutover', () => {
  const result = audit({
    registers: [register('register-a', 'managed-a'), register('register-b', 'missing')],
    openSessions: [managedSession('managed-a', 'register-a'), managedSession('managed-b', 'register-a')],
  });
  assert.ok(result.blockers.includes('MULTIPLE_OPEN_SESSIONS_PER_REGISTER'));
  assert.ok(result.blockers.includes('REGISTER_POINTER_WITHOUT_OPEN_SESSION'));
  assert.ok(result.blockers.includes('REGISTER_SESSION_POINTER_MISMATCH'));
});

test('truncated remote reads cannot certify migration readiness', () => {
  const result = audit({ openSessionLimitReached: true });
  assert.equal(result.remoteSnapshotComplete, false);
  assert.equal(result.remotePreflightClear, false);
  assert.ok(result.blockers.includes('REMOTE_SCAN_INCOMPLETE'));
});

test('owner/manager authenticated read-only route precedes disabled managed write gate', () => {
  const router = readFileSync('server/attendance/cashRegisterRouter.ts', 'utf8');
  const service = readFileSync('server/attendance/cashRegisterSessionService.ts', 'utf8');
  assert.ok(router.indexOf("router.get('/readiness'") < router.indexOf('router.use((_request, response, next)'));
  assert.match(router, /requireActorId\(request\.get\('authorization'\)/);
  assert.match(router, /Cache-Control', 'no-store, max-age=0'/);
  assert.match(service, /actor\.role !== 'owner' && actor\.role !== 'manager'/);
  assert.match(service, /requireTransactionActor\(transaction, actor\)/);
  assert.match(service, /limit\(101\)/);
  assert.match(router, /CASH_REGISTER_MANAGED_SESSIONS_ENABLED/);
});
