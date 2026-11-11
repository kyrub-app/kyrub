import assert from 'node:assert/strict';
import test from 'node:test';
import { issueVerifiedPitangaVoucherInTransaction } from '../server/gamification/pitangaVerifiedVoucherIssuance.js';
import type { KyrubRedemptionPlan } from '../shared/gamificationRedemption.js';

const uid = 'user1';
const id = 'redemption_user1_order1';
const plan: KyrubRedemptionPlan = {
  redemptionId: id, userId: uid, rewardId: 'gift1', voucherCode: 'KRB-GIFT1-ORDER1',
  validUntil: '2026-12-11T12:00:00Z',
  debitEntry: {
    id: `${id}_debit`, userId: uid, type: 'redeem', deltaKCoins: -500,
    sourceType: 'reward_redemption', sourceId: 'gift1',
    correlationId: 'corr1', idempotencyKey: 'redeem:order1',
    occurredAt: '2026-11-11T12:00:00Z',
  },
  auditEvent: { type: 'reward_redemption_planned', correlationId: 'corr1', idempotencyKey: 'order1' },
};
const ref = (path: string) => ({ path });
const root = `users/${uid}`;
const refs = {
  balanceRef: ref(`${root}/pitangaBalance/balance`),
  receiptRef: ref(`${root}/pitangaMigration/receipt`),
  fenceRef: ref('systemControl/pitangaLegacyWriterFence'),
  redemptionRef: ref(`${root}/rewardRedemptions/${id}`),
  voucherRef: ref(`${root}/rewardVouchers/${id}`),
  debitRef: ref(`${root}/rewardLedger/${id}_debit`),
  auditRef: ref(`${root}/rewardAudit/${id}`),
};
const epoch = 'migration_1';
const valid = (): Record<string, Record<string, unknown>> => ({
  [refs.balanceRef.path]: { userId: uid, migrationEpoch: epoch, availableKCoins: 1200 },
  [refs.receiptRef.path]: { userId: uid, fenceEpoch: epoch, balance: 1200, entryCount: 1, ledgerSha256: 'a'.repeat(64) },
  [refs.fenceRef.path]: { status: 'fenced', epoch, writersVerified: true },
});
const fixture = (records: Record<string, Record<string, unknown>>) => {
  const writes: Array<{ path: string; op: string; data: unknown }> = [];
  let reads = 0;
  const tx = {
    get: async (r: { path: string }) => {
      reads++;
      return { exists: Object.hasOwn(records, r.path), data: () => records[r.path] };
    },
    update: (r: { path: string }, data: unknown) => writes.push({ path: r.path, op: 'update', data }),
    create: (r: { path: string }, data: unknown) => writes.push({ path: r.path, op: 'create', data }),
  };
  return { tx, writes, get reads() { return reads; } };
};
const invoke = (f: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) =>
  issueVerifiedPitangaVoucherInTransaction(f.tx as never, { plan, ...refs, ...overrides } as never);

test('verified migration permits one atomic voucher issue', async () => {
  const f = fixture(valid());
  assert.deepEqual(await invoke(f), { redemptionId: id, remainingPitangas: 700, replay: false });
  assert.equal(f.writes.length, 5);
  assert.equal(f.writes.find(w => w.path === refs.balanceRef.path)?.op, 'update');
});

test('missing receipt refuses issuance without writes', async () => {
  const records = valid();
  delete records[refs.receiptRef.path];
  const f = fixture(records);
  await assert.rejects(invoke(f), /PITANGA_VOUCHER_MIGRATION_UNVERIFIED/);
  assert.equal(f.writes.length, 0);
});

test('unfenced or unverified writer state refuses issuance', async () => {
  for (const fence of [
    { status: 'open', epoch, writersVerified: true },
    { status: 'fenced', epoch, writersVerified: false },
    { status: 'fenced', epoch: 'other', writersVerified: true },
  ]) {
    const f = fixture({ ...valid(), [refs.fenceRef.path]: fence });
    await assert.rejects(invoke(f), /PITANGA_VOUCHER_MIGRATION_UNVERIFIED/);
    assert.equal(f.writes.length, 0);
  }
});

test('mismatched receipt epoch refuses issuance', async () => {
  const records = valid();
  records[refs.receiptRef.path] = { ...records[refs.receiptRef.path], fenceEpoch: 'other' };
  const f = fixture(records);
  await assert.rejects(invoke(f), /PITANGA_VOUCHER_MIGRATION_UNVERIFIED/);
  assert.equal(f.writes.length, 0);
});

test('forged reference refuses before reading Firestore', async () => {
  const f = fixture(valid());
  await assert.rejects(invoke(f, { receiptRef: ref(`users/other/pitangaMigration/receipt`) }), /PITANGA_VOUCHER_MIGRATION_REFERENCE_INVALID/);
  assert.equal(f.reads, 0);
});

test('verified migration still refuses insufficient balance', async () => {
  const records = valid();
  records[refs.balanceRef.path] = { ...records[refs.balanceRef.path], availableKCoins: 499 };
  const f = fixture(records);
  await assert.rejects(invoke(f), /PITANGA_VOUCHER_INSUFFICIENT_BALANCE/);
  assert.equal(f.writes.length, 0);
});

test('verified voucher replay is read-only after balance changes', async () => {
  const initial = fixture(valid());
  await invoke(initial);
  const records = valid();
  for (const write of initial.writes) {
    if (write.op === 'create') records[write.path] = write.data as Record<string, unknown>;
  }
  records[refs.balanceRef.path] = {
    ...records[refs.balanceRef.path],
    availableKCoins: 700,
  };
  const replay = fixture(records);
  assert.deepEqual(await invoke(replay), {
    redemptionId: id, remainingPitangas: 700, replay: true,
  });
  assert.equal(replay.writes.length, 0);
});

test('partial existing voucher cannot be repaired by migration gate', async () => {
  const records = valid();
  records[refs.voucherRef.path] = { code: plan.voucherCode };
  const f = fixture(records);
  await assert.rejects(invoke(f), /PITANGA_VOUCHER_PARTIAL_STATE/);
  assert.equal(f.writes.length, 0);
});

test('forged migration receipt digest is rejected without writes', async () => {
  const records = valid();
  records[refs.receiptRef.path] = {
    ...records[refs.receiptRef.path], ledgerSha256: 'invalid',
  };
  const f = fixture(records);
  await assert.rejects(invoke(f), /PITANGA_VOUCHER_MIGRATION_UNVERIFIED/);
  assert.equal(f.writes.length, 0);
});

test('balance from a different user is rejected despite valid receipt', async () => {
  const records = valid();
  records[refs.balanceRef.path] = {
    ...records[refs.balanceRef.path], userId: 'other',
  };
  const f = fixture(records);
  await assert.rejects(invoke(f), /PITANGA_VOUCHER_MIGRATION_UNVERIFIED/);
  assert.equal(f.writes.length, 0);
});
