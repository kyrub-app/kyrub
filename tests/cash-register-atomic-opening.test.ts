import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  assertCashRegisterOpenIdempotency,
  cashOpeningAmountMinor,
  normalizedCashRegisterName,
} from '../server/attendance/cashRegisterSessionService';

test('register display names are explicit and bounded', () => {
  assert.equal(normalizedCashRegisterName(' Caixa 01 '), 'Caixa 01');
  for (const value of ['', 'X', 'a'.repeat(61), 'Caixa\n02', 10]) {
    assert.throws(() => normalizedCashRegisterName(value), /CASH_REGISTER_NAME_INVALID/);
  }
});

test('opening amount is a bounded integer number of cents, not float money', () => {
  for (const value of [0, 100, 1299, 10_000_000_000]) {
    assert.equal(cashOpeningAmountMinor(value), value);
  }
  for (const value of [-1, 0.01, 100.2, Infinity, NaN, 10_000_000_001, '100', null]) {
    assert.throws(() => cashOpeningAmountMinor(value), /CASH_REGISTER_AMOUNT_INVALID/);
  }
});

const base = {
  existing: {
    registerId: 'register-a',
    openedByUserId: 'cashier-a',
    openingMinor: 12500,
    openOperationId: 'operation-1234',
    shiftLabel: 'Manhã',
    status: 'open',
  } as Record<string, unknown>,
  registerId: 'register-a',
  actorId: 'cashier-a',
  amountMinor: 12500,
  operationId: 'operation-1234',
  shiftLabel: 'Manhã',
};

test('opening replay only succeeds for identical actor/register/shift/value/operation', () => {
  assert.equal(assertCashRegisterOpenIdempotency({ ...base, existing: undefined }), 'create');
  assert.equal(assertCashRegisterOpenIdempotency(base), 'replay');
  for (const override of [
    { actorId: 'cashier-b' },
    { registerId: 'register-b' },
    { amountMinor: 15000 },
    { operationId: 'operation-9999' },
    { shiftLabel: 'Tarde' },
    { existing: { ...base.existing, openedByUserId: 'other' } },
  ]) {
    assert.throws(() =>
      assertCashRegisterOpenIdempotency({ ...base, ...override }),
      /CASH_REGISTER_IDEMPOTENCY_CONFLICT/
    );
  }
});

test('canonical register opening rechecks membership inside a Firestore transaction', () => {
  const service = readFileSync('server/attendance/cashRegisterSessionService.ts', 'utf8');
  assert.match(service, /authorizeInPersonOrderOperator\(\{/);
  assert.match(service, /permission: 'cash\.manage'/);
  assert.match(service, /transaction\.get\(adminDb\.doc\(/);
  assert.match(service, /clean\(current\?\.status\) !== 'active'/);
  assert.match(service, /transaction\.get\(register\)/);
  assert.match(service, /transaction\.get\(session\)/);
  assert.match(service, /transaction\.create\(session/);
  assert.match(service, /transaction\.update\(register/);
  assert.match(service, /activeSessionId: sessionId/);
  assert.match(service, /if \(clean\(registerValue\?\.activeSessionId\)\)/);
  assert.match(service, /transaction\.create\(/);
  assert.match(service, /audit-cash-open-/);
  assert.match(service, /cashSessions\/\$\{sessionId\}/);
  assert.match(service, /cashRegisters\/\$\{registerId\}/);
  assert.match(service, /name\.normalize\('NFKC'\)/);
  assert.doesNotMatch(service, /request\.body\?\.role/);
});

test('managed register endpoints remain fail-closed until old direct writes migrate', () => {
  const route = readFileSync('server/attendance/cashRegisterRouter.ts', 'utf8');
  const main = readFileSync('server/attendance/localAttendanceRouter.ts', 'utf8');
  const existing = readFileSync('src/utils/canonicalCash.ts', 'utf8');
  assert.match(route, /process\.env\.CASH_REGISTER_MANAGED_SESSIONS_ENABLED !== 'true'/);
  assert.match(route, /CASH_REGISTER_COORDINATION_NOT_ENABLED/);
  assert.match(route, /verifyFirebaseIdToken\(token\)/);
  assert.match(route, /router\.post\('\/:registerId\/open'/);
  assert.match(main, /router\.use\('\/cash-registers', createCashRegisterRouter\(\)\)/);
  assert.match(existing, /export const openCashSession/);
  assert.match(existing, /const persistSessionOpen/);
  assert.doesNotMatch(existing, /CASH_REGISTER_MANAGED_SESSIONS_ENABLED/);
});
