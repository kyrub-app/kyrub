import assert from 'node:assert/strict';
import test from 'node:test';
import { issueVerifiedPitangaVoucher } from '../server/gamification/pitangaVoucherIssuanceService.js';
import type { KyrubRedemptionPlan } from '../shared/gamificationRedemption.js';

const plan = {
  userId: 'user1',
  redemptionId: 'redemption_user1_order1',
} as KyrubRedemptionPlan;

test('rejects invalid voucher service identifiers before starting a transaction', async () => {
  let calls = 0;
  const db = { runTransaction: async () => { calls++; } };
  await assert.rejects(
    () => issueVerifiedPitangaVoucher(db as never, { ...plan, userId: 'other/user' }),
    /PITANGA_VOUCHER_SERVICE_INPUT_INVALID/,
  );
  await assert.rejects(
    () => issueVerifiedPitangaVoucher(db as never, { ...plan, redemptionId: 'bad/path' }),
    /PITANGA_VOUCHER_SERVICE_INPUT_INVALID/,
  );
  assert.equal(calls, 0);
});

test('verified voucher adapter constructs canonical document paths', async () => {
  const paths: string[] = [];
  const doc = (path: string): unknown => ({
    path,
    collection: (name: string) => ({
      doc: (id: string) => doc(`${path}/${name}/${id}`),
    }),
  });
  const db = {
    collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }),
    doc: (path: string) => doc(path),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      get: async (ref: { path: string }) => {
        paths.push(ref.path);
        return { exists: false, data: () => undefined };
      },
    }),
  };
  await assert.rejects(
    () => issueVerifiedPitangaVoucher(db as never, plan),
    /PITANGA_VOUCHER_MIGRATION_UNVERIFIED/,
  );
  assert.deepEqual(paths.sort(), [
    'systemControl/pitangaLegacyWriterFence',
    'users/user1/pitangaBalance/balance',
    'users/user1/pitangaMigration/receipt',
  ].sort());
});
