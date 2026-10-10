import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  validateManagedCashMovementInput,
} from '../server/attendance/cashRegisterSessionService';

const base = {
  type: 'supply',
  direction: 'in',
  amountMinor: 4500,
  description: 'Troco de abertura',
  category: 'Suprimento',
  reason: '',
};

test('cash movement validates centavos inteiros and explicit direction', () => {
  assert.deepEqual(validateManagedCashMovementInput(base), base);
  assert.equal(validateManagedCashMovementInput({
    ...base, type: 'withdrawal', direction: 'out', reason: 'Retirada'
  }).amountMinor, 4500);
  for (const amountMinor of [0, -100, 12.5, NaN, Infinity, 10_000_000_001, '200']) {
    assert.throws(
      () => validateManagedCashMovementInput({ ...base, amountMinor }),
      /CASH_REGISTER_AMOUNT_INVALID/
    );
  }
  assert.throws(
    () => validateManagedCashMovementInput({ ...base, type: 'expense', direction: 'in', reason: 'Entrega' }),
    /CASH_REGISTER_MOVEMENT_DIRECTION_INVALID/
  );
  assert.throws(
    () => validateManagedCashMovementInput({ ...base, type: 'withdrawal', direction: 'out', reason: '' }),
    /CASH_REGISTER_MOVEMENT_REASON_REQUIRED/
  );
});

test('provider settlement and manual sales cannot be written through physical ledger', () => {
  for (const type of ['sale', 'payment_capture', 'payment_refund', 'pix', 'card']) {
    assert.throws(
      () => validateManagedCashMovementInput({ ...base, type }),
      /CASH_REGISTER_MOVEMENT_TYPE_INVALID/
    );
  }
  assert.throws(
    () => validateManagedCashMovementInput({ ...base, direction: 'out' }),
    /CASH_REGISTER_MOVEMENT_DIRECTION_INVALID/
  );
});

test('cash movements and closing serialize on same canonical session and register', () => {
  const service = readFileSync('server/attendance/cashRegisterSessionService.ts', 'utf8');
  assert.match(service, /export const addCanonicalCashRegisterMovement/);
  assert.match(service, /export const closeCanonicalCashRegisterSession/);
  assert.match(service, /const registerRef = adminDb\.doc\(registerPath/);
  assert.match(service, /const sessionRef = adminDb\.doc\(sessionPath/);
  assert.match(service, /transaction\.get\(sessionRef\)/);
  assert.match(service, /transaction\.get\(registerRef\)/);
  assert.match(service, /transaction\.create\(movementRef/);
  assert.match(service, /movementNetMinor: newNetMinor/);
  assert.match(service, /movementCount: totals\.count \+ 1/);
  assert.match(service, /revision: totals\.revision \+ 1/);
  assert.match(service, /transaction\.update\(sessionRef/);
  assert.match(service, /transaction\.update\(registerRef/);
  assert.match(service, /activeSessionId: ''/);
  assert.match(service, /if \(status !== 'open' \|\| clean\(register\?\.activeSessionId\) !== sessionId\)/);
  assert.match(service, /if \(clean\(session\?\.status\) !== 'open' \|\| clean\(register\?\.activeSessionId\) !== sessionId\)/);
  assert.match(service, /actor\.role === 'cashier' &&/);
  assert.match(service, /clean\(session\?\.openedByUserId\) !== actor\.actorId/);
  assert.match(service, /differenceMinor = countedMinor - totals\.expectedMinor/);
  assert.match(service, /CASH_REGISTER_CLOSE_REASON_REQUIRED/);
  assert.match(service, /if \(movementSnapshot\.exists\)/);
  assert.match(service, /CASH_REGISTER_IDEMPOTENCY_CONFLICT/);
  assert.match(service, /clean\(session\?\.closeOperationId\) !== operationId/);
});

test('managed Cash API keeps owner workflow intact and both endpoints disabled by default', () => {
  const router = readFileSync('server/attendance/cashRegisterRouter.ts', 'utf8');
  const source = readFileSync('src/utils/canonicalCash.ts', 'utf8');
  const workspace = readFileSync('src/components/store/CashWorkspace.tsx', 'utf8');
  assert.match(router, /CASH_REGISTER_MANAGED_SESSIONS_ENABLED !== 'true'/);
  assert.match(router, /router\.post\('\/:registerId\/sessions\/:sessionId\/movements'/);
  assert.match(router, /router\.post\('\/:registerId\/sessions\/:sessionId\/close'/);
  assert.match(router, /requireActorId\(request\.get\('authorization'\)/);
  assert.match(source, /export const closeCashSession/);
  assert.match(workspace, /await closeCashSession\(/);
  assert.doesNotMatch(workspace, /addCanonicalCashRegisterMovement|closeCanonicalCashRegisterSession/);
});
