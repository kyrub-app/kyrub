import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFirstLoginReceiptInTransaction } from '../server/gamification/firstLoginReceiptVerification.js';

const uid = 'user_1';
const createdAt = '2026-11-12T12:00:00.000Z';
const receiptRef = { path: `users/${uid}/authEvents/first_login_v1` } as any;
const valid = {
  userId: uid, eventType: 'first_login', schemaVersion: 1,
  issuer: 'trusted_auth_server', firebaseCreatedAt: createdAt,
  occurredAt: '2026-11-12T12:00:01.000Z',
};
const tx = (receipt?: unknown) => ({
  get: async () => ({ exists: receipt !== undefined, data: () => receipt }),
}) as any;

test('trusted immutable receipt validates with canonical event time', async () => {
  assert.deepEqual(await verifyFirstLoginReceiptInTransaction(tx(valid), {
    userId: uid, firebaseCreatedAt: createdAt, receiptRef,
  }), { occurredAt: valid.occurredAt });
});

test('missing receipt cannot authorize a welcome grant', async () => {
  await assert.rejects(verifyFirstLoginReceiptInTransaction(tx(), {
    userId: uid, firebaseCreatedAt: createdAt, receiptRef,
  }), /RECEIPT_MISSING/);
});

test('client, wrong user, or mutable sign-in metadata cannot masquerade as proof', async () => {
  for (const patch of [
    { issuer: 'client' }, { userId: 'another_user' },
    { eventType: 'last_sign_in' }, { schemaVersion: 2 },
    { firebaseCreatedAt: '2026-11-12T11:59:00.000Z' },
    { occurredAt: '2026-11-13T12:00:02.000Z' },
    { occurredAt: '2026-11-12T11:59:59.000Z' },
  ]) {
    await assert.rejects(verifyFirstLoginReceiptInTransaction(tx({ ...valid, ...patch }), {
      userId: uid, firebaseCreatedAt: createdAt, receiptRef,
    }), /RECEIPT_INVALID/);
  }
});

test('receipt cannot be read from a different account or path', async () => {
  await assert.rejects(verifyFirstLoginReceiptInTransaction(tx(valid), {
    userId: uid, firebaseCreatedAt: createdAt,
    receiptRef: { path: 'users/other/authEvents/first_login_v1' } as any,
  }), /REFERENCE_INVALID/);
});
