import assert from 'node:assert/strict';
import test from 'node:test';
import { applyVerifiedPitangaXpConversionInTransaction } from '../server/gamification/pitangaVerifiedXpConversion.js';

const uid = 'user1';
const ref = (path: string) => ({ path, id: path.split('/').at(-1), parent: { path: path.split('/').slice(0, -1).join('/') } });
const refs = {
  balanceRef: ref('users/user1/pitangaBalance/balance'),
  migrationReceiptRef: ref('users/user1/pitangaMigration/receipt'),
  fenceRef: ref('systemControl/pitangaLegacyWriterFence'),
  receiptRef: ref('users/user1/pitangaXpConversions/req1'),
  debitRef: ref('users/user1/rewardLedger/conversion_req1'),
  xpRef: ref('users/user1/xpLedger/conversion_req1'),
};
const valid = (): Record<string, Record<string, unknown>> => ({
  [refs.balanceRef.path]: { userId: uid, availableKCoins: 2000, migrationEpoch: 'epoch1' },
  [refs.migrationReceiptRef.path]: {
    userId: uid, balance: 2000, entryCount: 2, ledgerSha256: 'a'.repeat(64), historicalMembershipSha256: 'b'.repeat(64), fenceEpoch: 'epoch1',
  },
  [refs.fenceRef.path]: { epoch: 'epoch1', status: 'fenced', writersVerified: true },
});
const run = (records: Record<string, Record<string, unknown>>, override: Record<string, unknown> = {}) => {
  const writes: Array<{ operation: string; path: string }> = [];
  const tx = {
    get: async (r: { path: string }) => ({
      exists: Object.hasOwn(records, r.path), data: () => records[r.path],
    }),
    update: (r: { path: string }) => writes.push({ operation: 'update', path: r.path }),
    create: (r: { path: string }) => writes.push({ operation: 'create', path: r.path }),
  };
  return {
    writes,
    result: applyVerifiedPitangaXpConversionInTransaction(tx as never, {
      ...refs, userId: uid, requestId: 'req1', requestedXp: 1,
      occurredAt: '2026-11-11T12:00:00Z', ...override,
    } as never),
  };
};

test('verified migration permits atomic conversion', async () => {
  const { result, writes } = run(valid());
  assert.deepEqual(await result, {
    xpCredited: 1, pitangasDebited: 1000, remainingPitangas: 1000, replay: false,
  });
  assert.equal(writes.length, 4);
});

test('conversion rejects missing migration receipt without writes', async () => {
  const records = valid();
  delete records[refs.migrationReceiptRef.path];
  const { result, writes } = run(records);
  await assert.rejects(result, /CONVERSION_MIGRATION_UNVERIFIED/);
  assert.equal(writes.length, 0);
});

test('conversion rejects stale and unverified writer fences', async () => {
  for (const fence of [
    { epoch: 'other', status: 'fenced', writersVerified: true },
    { epoch: 'epoch1', status: 'open', writersVerified: true },
    { epoch: 'epoch1', status: 'fenced', writersVerified: false },
  ]) {
    const records = valid();
    records[refs.fenceRef.path] = fence;
    const { result, writes } = run(records);
    await assert.rejects(result, /CONVERSION_MIGRATION_UNVERIFIED/);
    assert.equal(writes.length, 0);
  }
});

test('conversion rejects receipt epoch mismatch and forged digest', async () => {
  for (const patch of [{ fenceEpoch: 'other' }, { ledgerSha256: 'invalid' }]) {
    const records = valid();
    records[refs.migrationReceiptRef.path] = { ...records[refs.migrationReceiptRef.path], ...patch };
    const { result, writes } = run(records);
    await assert.rejects(result, /CONVERSION_MIGRATION_UNVERIFIED/);
    assert.equal(writes.length, 0);
  }
});

test('conversion rejects cross-user migration references before reads', async () => {
  let reads = 0;
  const records = valid();
  const { result, writes } = run(records, {
    migrationReceiptRef: ref('users/other/pitangaMigration/receipt'),
  });
  await assert.rejects(result, /CONVERSION_MIGRATION_REFERENCE_INVALID/);
  assert.equal(reads, 0);
  assert.equal(writes.length, 0);
});

test('conversion rejects insufficient balance after migration checks', async () => {
  const records = valid();
  records[refs.balanceRef.path] = { ...records[refs.balanceRef.path], availableKCoins: 999 };
  const { result, writes } = run(records);
  await assert.rejects(result, /PITANGA_BALANCE_INSUFFICIENT/);
  assert.equal(writes.length, 0);
});

test('verified conversion cannot use a second receipt for the same request', async () => {
  const { result, writes } = run(valid(), {
    receiptRef: ref('users/user1/pitangaXpConversions/anotherReceipt'),
  });
  await assert.rejects(result, /CONVERSION_MIGRATION_REFERENCE_INVALID/);
  assert.equal(writes.length, 0);
});

test('verified conversion rejects alternate debit or XP document for the same request', async () => {
  for (const override of [
    { debitRef: ref('users/user1/rewardLedger/alternate_debit') },
    { xpRef: ref('users/user1/xpLedger/alternate_xp') },
  ]) {
    const { result, writes } = run(valid(), override);
    await assert.rejects(result, /CONVERSION_MIGRATION_REFERENCE_INVALID/);
    assert.equal(writes.length, 0);
  }
});

test('conversion refuses migration receipts without historical membership proof', async () => {
  for (const invalid of [undefined, 'not-a-digest']) {
    const records = valid();
    records[refs.migrationReceiptRef.path] = {
      ...records[refs.migrationReceiptRef.path],
      historicalMembershipSha256: invalid,
    };
    const { result, writes } = run(records);
    await assert.rejects(result, /CONVERSION_MIGRATION_UNVERIFIED/);
    assert.equal(writes.length, 0);
  }
});
