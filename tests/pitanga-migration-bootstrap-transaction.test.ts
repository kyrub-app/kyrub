import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapPitangaBalanceInTransaction } from '../server/gamification/pitangaMigrationBootstrapTransaction.js';

const checkpoint = {
  userId: 'user1', balance: 1000, entryCount: 2,
  ledgerSha256: 'a'.repeat(64),
};
const ref = (path: string) => ({ path });
const refs = {
  balanceRef: ref('users/user1/pitangaBalance/balance'),
  receiptRef: ref('users/user1/pitangaMigration/receipt'),
  fenceRef: ref('systemControl/pitangaLegacyWriterFence'),
};
const snap = (data?: Record<string, unknown>) => ({
  exists: data !== undefined, data: () => data,
});
const run = (data: {
  fence?: Record<string, unknown>;
  balance?: Record<string, unknown>;
  receipt?: Record<string, unknown>;
}, override: Record<string, unknown> = {}) => {
  const writes: Array<{ kind: string; path: string; data: unknown }> = [];
  const snapshots: Record<string, ReturnType<typeof snap>> = {
    [refs.fenceRef.path]: snap(data.fence),
    [refs.balanceRef.path]: snap(data.balance),
    [refs.receiptRef.path]: snap(data.receipt),
  };
  const tx = {
    get: async (r: { path: string }) => snapshots[r.path],
    create: (r: { path: string }, value: unknown) => {
      writes.push({ kind: 'create', path: r.path, data: value });
    },
  };
  return {
    writes,
    result: bootstrapPitangaBalanceInTransaction(tx as never, {
      checkpoint, fenceEpoch: 'epoch1', ...refs, ...override,
    } as never),
  };
};
const fence = { status: 'fenced', epoch: 'epoch1', writersVerified: true };

test('creates balance and receipt atomically after verified fence', async () => {
  const { result, writes } = run({ fence });
  assert.deepEqual(await result, { balance: 1000, replay: false });
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(w => w.path), [
    refs.balanceRef.path, refs.receiptRef.path,
  ]);
});

test('rejects absent or mismatched fence without writes', async () => {
  for (const badFence of [undefined, { ...fence, status: 'open' },
    { ...fence, epoch: 'other' }, { ...fence, writersVerified: false }]) {
    const { result, writes } = run({ fence: badFence });
    await assert.rejects(result, /PITANGA_BOOTSTRAP_FENCE_UNVERIFIED/);
    assert.equal(writes.length, 0);
  }
});

test('replay is read-only and requires matching receipt', async () => {
  const balance = { userId: 'user1', availableKCoins: 1000, migrationEpoch: 'epoch1' };
  const receipt = { userId: 'user1', balance: 1000, entryCount: 2,
    ledgerSha256: checkpoint.ledgerSha256, fenceEpoch: 'epoch1' };
  const { result, writes } = run({ fence, balance, receipt });
  assert.deepEqual(await result, { balance: 1000, replay: true });
  assert.equal(writes.length, 0);
  await assert.rejects(run({ fence, balance, receipt: {
    ...receipt, ledgerSha256: 'b'.repeat(64),
  } }).result, /PITANGA_BOOTSTRAP_CONFLICT/);
});

test('rejects partial state and invalid document paths', async () => {
  await assert.rejects(run({
    fence, balance: { userId: 'user1', availableKCoins: 1000 },
  }).result, /PITANGA_BOOTSTRAP_PARTIAL_STATE/);
  await assert.rejects(run({ fence }, {
    balanceRef: ref('users/user2/pitangaBalance/balance'),
  }).result, /PITANGA_BOOTSTRAP_REFERENCE_INVALID/);
});

test('rejects invalid checkpoints before reading or writing', async () => {
  for (const invalid of [
    { ...checkpoint, userId: '../other' },
    { ...checkpoint, balance: -1 },
    { ...checkpoint, balance: 1.5 },
    { ...checkpoint, entryCount: -1 },
    { ...checkpoint, ledgerSha256: 'not-a-digest' },
  ]) {
    const { result, writes } = run({ fence }, { checkpoint: invalid });
    await assert.rejects(result, /PITANGA_BOOTSTRAP_INPUT_INVALID/);
    assert.equal(writes.length, 0);
  }
});

test('does not overwrite an existing balance without a receipt', async () => {
  const { result, writes } = run({
    fence, balance: { userId: 'user1', availableKCoins: 900 },
  });
  await assert.rejects(result, /PITANGA_BOOTSTRAP_PARTIAL_STATE/);
  assert.equal(writes.length, 0);
});

test('rejects a matching receipt with a different existing balance', async () => {
  const receipt = { userId: 'user1', balance: 1000, entryCount: 2,
    ledgerSha256: checkpoint.ledgerSha256, fenceEpoch: 'epoch1' };
  const { result, writes } = run({
    fence, receipt, balance: { userId: 'user1', availableKCoins: 999 },
  });
  await assert.rejects(result, /PITANGA_BOOTSTRAP_CONFLICT/);
  assert.equal(writes.length, 0);
});

test('rejects a replay with missing or mismatched balance migration epoch', async () => {
  const receipt = { userId: 'user1', balance: 1000, entryCount: 2,
    ledgerSha256: checkpoint.ledgerSha256, fenceEpoch: 'epoch1' };
  for (const balance of [
    { userId: 'user1', availableKCoins: 1000 },
    { userId: 'user1', availableKCoins: 1000, migrationEpoch: 'other' },
  ]) {
    const { result, writes } = run({ fence, balance, receipt });
    await assert.rejects(result, /PITANGA_BOOTSTRAP_CONFLICT/);
    assert.equal(writes.length, 0);
  }
});
