import assert from 'node:assert/strict';
import test from 'node:test';
import { issuePitangaVoucherInTransaction } from '../server/gamification/pitangaVoucherIssuanceTransaction.js';
import type { KyrubRedemptionPlan } from '../shared/gamificationRedemption.js';

const userId = 'user1';
const redemptionId = 'redemption_user1_order1';
const plan: KyrubRedemptionPlan = {
  redemptionId, userId, rewardId: 'gift1', voucherCode: 'KRB-GIFT1-ORDER1',
  validUntil: '2026-12-11T12:00:00Z',
  debitEntry: {
    id: `${redemptionId}_debit`, userId, type: 'redeem',
    deltaKCoins: -500, sourceType: 'reward_redemption', sourceId: 'gift1',
    correlationId: 'corr1', idempotencyKey: 'redeem:order1',
    occurredAt: '2026-11-11T12:00:00Z',
  },
  auditEvent: { type: 'reward_redemption_planned', correlationId: 'corr1', idempotencyKey: 'order1' },
};
const ref = (collection: string, id: string) => ({
  id, path: `users/${userId}/${collection}/${id}`,
  parent: { path: `users/${userId}/${collection}` },
});
const refs = {
  balanceRef: ref('pitangaBalance', 'balance'),
  redemptionRef: ref('rewardRedemptions', redemptionId),
  voucherRef: ref('rewardVouchers', redemptionId),
  debitRef: ref('rewardLedger', `${redemptionId}_debit`),
  auditRef: ref('rewardAudit', redemptionId),
};
const fixture = (available: number | null, previous: Record<string, Record<string, unknown>> = {}) => {
  const writes: Array<{ op: string; path: string; data: Record<string, unknown> }> = [];
  let reads = 0;
  const snapshots = new Map<string, Record<string, unknown>>(Object.entries(previous));
  if (available !== null) snapshots.set(refs.balanceRef.path, { userId, availableKCoins: available });
  const tx = {
    get: async (r: { path: string }) => {
      reads++;
      return { exists: snapshots.has(r.path), data: () => snapshots.get(r.path) };
    },
    create: (r: { path: string }, data: Record<string, unknown>) => writes.push({ op: 'create', path: r.path, data }),
    update: (r: { path: string }, data: Record<string, unknown>) => writes.push({ op: 'update', path: r.path, data }),
  };
  return { tx, writes, get reads() { return reads; } };
};
const invoke = (tx: unknown, overrides: Record<string, unknown> = {}) =>
  issuePitangaVoucherInTransaction(tx as never, { plan, ...refs, ...overrides } as never);

test('issues voucher, debit, audit and balance update in one transaction', async () => {
  const f = fixture(1200);
  assert.deepEqual(await invoke(f.tx), { redemptionId, remainingPitangas: 700, replay: false });
  assert.equal(f.writes.length, 5);
  assert.equal(f.writes.find(w => w.path === refs.balanceRef.path)?.data.availableKCoins, 700);
  assert.equal(f.writes.find(w => w.path === refs.debitRef.path)?.data.deltaKCoins, -500);
  assert.equal(f.writes.find(w => w.path === refs.voucherRef.path)?.data.status, 'active');
});

test('insufficient balance never issues voucher', async () => {
  const f = fixture(499);
  await assert.rejects(() => invoke(f.tx), /PITANGA_VOUCHER_INSUFFICIENT_BALANCE/);
  assert.equal(f.writes.length, 0);
});

test('missing historical balance authority fails closed', async () => {
  const f = fixture(null);
  await assert.rejects(() => invoke(f.tx), /PITANGA_VOUCHER_BALANCE_UNAVAILABLE/);
  assert.equal(f.writes.length, 0);
});

test('shadow balance reference rejected before any reads', async () => {
  const f = fixture(1200);
  await assert.rejects(() => invoke(f.tx, {
    balanceRef: ref('pitangaBalance', 'shadow'),
  }), /PITANGA_VOUCHER_REFERENCE_INVALID/);
  assert.equal(f.reads, 0);
});

test('partial historical voucher state rejected without writes', async () => {
  const f = fixture(700, { [refs.voucherRef.path]: { code: plan.voucherCode } });
  await assert.rejects(() => invoke(f.tx), /PITANGA_VOUCHER_PARTIAL_STATE/);
  assert.equal(f.writes.length, 0);
});

test('complete matching replay is read-only', async () => {
  const initial = fixture(1200);
  await invoke(initial.tx);
  const previous = Object.fromEntries(initial.writes.filter(w => w.op === 'create').map(w => [w.path, w.data]));
  const replay = fixture(700, previous);
  assert.deepEqual(await invoke(replay.tx), { redemptionId, remainingPitangas: 700, replay: true });
  assert.equal(replay.writes.length, 0);
  const changed = { ...plan, voucherCode: 'DIFFERENT' };
  await assert.rejects(() => invoke(replay.tx, { plan: changed }), /PITANGA_VOUCHER_IDEMPOTENCY_CONFLICT/);
});

test('rejects voucher issuance with an unexpected audit event before reads', async () => {
  const f = fixture(1200);
  const invalidPlan = {
    ...plan,
    auditEvent: { ...plan.auditEvent, type: 'reward_redemption_issued' },
  };
  await assert.rejects(() => invoke(f.tx, { plan: invalidPlan }),
    /PITANGA_VOUCHER_PLAN_INVALID/);
  assert.equal(f.reads, 0);
  assert.equal(f.writes.length, 0);
});
