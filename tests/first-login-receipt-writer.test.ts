import test from 'node:test';
import assert from 'node:assert/strict';
import { recordVerifiedFirstLoginInTransaction } from '../server/gamification/firstLoginReceiptWriter.js';

const uid = 'user_1';
const receiptRef = { path: `users/${uid}/authEvents/first_login_v1` } as any;
const base = {
  userId: uid, firebaseCreatedAt: '2026-11-12T12:00:00.000Z',
  occurredAt: '2026-11-12T12:00:01.000Z',
  trustedFirstLoginEvent: true, sourceEventId: 'auth-create-user-1', receiptRef,
};
const receipt = {
  userId: uid, eventType: 'first_login', schemaVersion: 1,
  issuer: 'trusted_auth_server', sourceEventId: base.sourceEventId, firebaseCreatedAt: base.firebaseCreatedAt,
  occurredAt: base.occurredAt,
};
function mock(existing?: unknown) {
  const writes: unknown[] = [];
  return {
    tx: {
      get: async () => ({ exists: existing !== undefined, data: () => existing }),
      create: (_ref: unknown, value: unknown) => { writes.push(value); },
    } as any,
    writes,
  };
}

test('trusted first login creates one immutable receipt', async () => {
  const { tx, writes } = mock();
  assert.deepEqual(await recordVerifiedFirstLoginInTransaction(tx, base), { recorded: true });
  assert.deepEqual(writes, [receipt]);
});

test('exact replay is idempotent', async () => {
  const { tx, writes } = mock(receipt);
  assert.deepEqual(await recordVerifiedFirstLoginInTransaction(tx, base), { recorded: false });
  assert.equal(writes.length, 0);
});

test('same account with different source event ID conflicts rather than rewriting receipt', async () => {
  const { tx, writes } = mock({ ...receipt, sourceEventId: 'auth-create-other-event' });
  await assert.rejects(recordVerifiedFirstLoginInTransaction(tx, base), /RECEIPT_CONFLICT/);
  assert.equal(writes.length, 0);
});

test('different event timestamp conflicts rather than rewriting receipt', async () => {
  const { tx, writes } = mock({ ...receipt, occurredAt: '2026-11-12T12:00:02.000Z' });
  await assert.rejects(recordVerifiedFirstLoginInTransaction(tx, base), /RECEIPT_CONFLICT/);
  assert.equal(writes.length, 0);
});

test('untrusted source, wrong reference and invalid time never create receipts', async () => {
  for (const patch of [
    { trustedFirstLoginEvent: false },
    { sourceEventId: '' },
    { sourceEventId: 'invalid event id' },
    { sourceEventId: 'short' },
    { receiptRef: { path: 'users/other/authEvents/first_login_v1' } as any },
    { occurredAt: '2026-11-12T11:59:59.000Z' },
    { occurredAt: '2026-11-13T12:00:02.000Z' },
  ]) {
    const { tx, writes } = mock();
    await assert.rejects(recordVerifiedFirstLoginInTransaction(tx, { ...base, ...patch }));
    assert.equal(writes.length, 0);
  }
});
