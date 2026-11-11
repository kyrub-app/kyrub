import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { buildKyrubRedemptionPlan } from '../shared/gamificationRedemption.js';

let pathReads = 0;
let transactionHandler: (callback: (tx: any) => Promise<unknown>) => Promise<unknown> = async () => { throw new Error('UNEXPECTED_TRANSACTION'); };
const db = {
  doc: (path: string) => { pathReads++; return { path }; },
  runTransaction: (callback: (tx: any) => Promise<unknown>) => transactionHandler(callback),
};
(globalThis as any).__redemptionSecurityDb = db;
const bundle = await build({
  entryPoints: ['server/gamification/redemptionRepository.ts'],
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'mock-redemption-db', setup(b) {
    b.onResolve({ filter: /firebaseAdmin\.js$|^firebase-admin\/firestore$/ }, args => ({ path: args.path, namespace: 'mock' }));
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: args.path.endsWith('firebaseAdmin.js')
      ? 'export const adminDb = globalThis.__redemptionSecurityDb;'
      : 'export const FieldValue = { serverTimestamp: () => "SERVER_TIME" };' }));
  } }],
});
const api = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const reward = {
  id: 'reward-1', title: 'Voucher', description: 'Teste', costKCoins: 100,
  fundingType: 'store' as const, storeId: 'store-1',
  benefit: { type: 'voucher' as const, voucherTemplateId: 'template-1' },
};
const plan = buildKyrubRedemptionPlan({
  userId: 'user-1', reward, currentBalanceKCoins: 100,
  idempotencyKey: 'idem-1', correlationId: 'corr-1',
  occurredAt: '2026-08-23T12:00:00Z', validUntil: '2026-09-23T12:00:00Z',
});

test('rejects forged redemption path segments before any Firestore reference', async () => {
  for (const mutation of [
    { userId: '../other' },
    { redemptionId: 'other/entry' },
    { debitEntry: { ...plan.debitEntry, id: 'ledger/foreign' } },
  ]) {
    pathReads = 0;
    await assert.rejects(api.persistKyrubRedemptionAtomically({ ...plan, ...mutation }), /REDEMPTION_PATH_INVALID/);
    assert.equal(pathReads, 0);
  }
});

test('rejects forged debit provenance before any Firestore reference', async () => {
  for (const mutation of [
    { userId: 'other' },
    { sourceType: 'conversion' },
    { sourceId: 'other-reward' },
    { deltaKCoins: 1 },
  ]) {
    pathReads = 0;
    const modified = mutation.userId
      ? { ...plan, debitEntry: { ...plan.debitEntry, userId: mutation.userId } }
      : { ...plan, debitEntry: { ...plan.debitEntry, ...mutation } };
    await assert.rejects(api.persistKyrubRedemptionAtomically(modified), /REDEMPTION_DEBIT_INVALID/);
    assert.equal(pathReads, 0);
  }
});

test('replay refuses a persisted debit whose amount differs from the requested plan', async () => {
  const stored = new Map<string, Record<string, unknown>>();
  const redemptionId = plan.redemptionId;
  stored.set(`users/${plan.userId}/rewardRedemptions/${redemptionId}`, {
    redemptionId, userId: plan.userId, rewardId: plan.rewardId,
    idempotencyKey: plan.auditEvent.idempotencyKey,
    correlationId: plan.auditEvent.correlationId,
  });
  stored.set(`users/${plan.userId}/rewardVouchers/${redemptionId}`, {});
  stored.set(`users/${plan.userId}/rewardAudit/${redemptionId}`, {});
  stored.set(`users/${plan.userId}/rewardLedger/${plan.debitEntry.id}`, {
    ...plan.debitEntry, economy: 'k_coin', deltaKCoins: -1,
  });
  let writes = 0;
  const replayDb = {
    doc: (path: string) => ({ path }),
    runTransaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      get: async (ref: { path: string }) => ({
        exists: stored.has(ref.path), data: () => stored.get(ref.path),
      }),
      create: () => { writes++; },
    }),
  };
  transactionHandler = replayDb.runTransaction;
  try {
    await assert.rejects(api.persistKyrubRedemptionAtomically(plan), /REDEMPTION_LEDGER_INCONSISTENT/);
    assert.equal(writes, 0);
  } finally {
    transactionHandler = async () => { throw new Error('UNEXPECTED_TRANSACTION'); };
  }
});

test('replay refuses voucher metadata inconsistent with the committed redemption', async () => {
  const stored = new Map<string, Record<string, unknown>>();
  const id = plan.redemptionId;
  stored.set(`users/${plan.userId}/rewardRedemptions/${id}`, {
    redemptionId: id, userId: plan.userId, rewardId: plan.rewardId,
    voucherCode: plan.voucherCode, validUntil: plan.validUntil,
    idempotencyKey: plan.auditEvent.idempotencyKey,
    correlationId: plan.auditEvent.correlationId,
  });
  stored.set(`users/${plan.userId}/rewardVouchers/${id}`, {
    redemptionId: id, userId: plan.userId, rewardId: plan.rewardId,
    code: 'FORGED', validUntil: plan.validUntil,
  });
  stored.set(`users/${plan.userId}/rewardAudit/${id}`, {
    redemptionId: id, userId: plan.userId, type: 'reward_redemption_issued',
    correlationId: plan.auditEvent.correlationId, idempotencyKey: plan.auditEvent.idempotencyKey,
  });
  stored.set(`users/${plan.userId}/rewardLedger/${plan.debitEntry.id}`, {
    ...plan.debitEntry, economy: 'k_coin',
  });
  let writes = 0;
  transactionHandler = async (callback: (tx: unknown) => Promise<unknown>) => callback({
      get: async (ref: { path: string }) => ({
        exists: stored.has(ref.path), data: () => stored.get(ref.path),
      }),
      create: () => { writes++; },
    });
  try {
    await assert.rejects(api.persistKyrubRedemptionAtomically(plan), /REDEMPTION_ATOMIC_STATE_CONFLICT/);
    assert.equal(writes, 0);
  } finally {
    (globalThis as any).__redemptionSecurityDb = db;
  }
});
