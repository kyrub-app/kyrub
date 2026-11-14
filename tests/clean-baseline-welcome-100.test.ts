import test from 'node:test';
import assert from 'node:assert/strict';
import { grantCleanBaselineWelcomeInTransaction } from '../server/gamification/cleanBaselineWelcomeTransaction.js';

const uid = 'new_user_1';
const createdAt = '2026-11-12T12:00:00.000Z';
const occurredAt = '2026-11-12T12:00:01.000Z';
const awardId = 'earn_first_login_welcome_v1';
const ref = (path: string): any => ({ path, id: path.split('/').at(-1), parent: { path: path.split('/').slice(0, -1).join('/') } });
const receipt = { userId: uid, eventType: 'first_login', schemaVersion: 1, issuer: 'trusted_auth_server', sourceEventId: 'auth-create-new-user-1', firebaseCreatedAt: createdAt, occurredAt };
const award = {
  id: awardId, userId: uid, type: 'earn', economy: 'k_coin', deltaKCoins: 100,
  sourceType: 'campaign', sourceId: 'first_login_welcome_v1',
  correlationId: 'first_login_welcome_v1', idempotencyKey: 'pitanga_earn_first_login_welcome_v1', occurredAt,
};
const inputs = (overrides: Record<string, unknown> = {}) => ({
  userId: uid, firebaseCreatedAt: createdAt,
  campaignEffectiveAt: '2026-11-12T00:00:00.000Z', isolatedCleanBaseline: true,
  receiptRef: ref(`users/${uid}/authEvents/first_login_v1`),
  balanceRef: ref(`users/${uid}/pitangaBalance/balance`),
  ledgerCollection: { path: `users/${uid}/rewardLedger`, limit: () => ({ query: 'ledger' }) } as any,
  awardRef: ref(`users/${uid}/rewardLedger/${awardId}`),
  ...overrides,
});
const harness = (opts: { receipt?: unknown; balance?: unknown; ledger?: boolean; award?: unknown } = {}) => {
  const writes: { path: string; data: unknown }[] = [];
  const tx: any = {
    get: async (target: any) => {
      if (target.query === 'ledger') return { empty: !opts.ledger };
      const path = target.path as string;
      const data = path.includes('/authEvents/') ? (opts.receipt ?? receipt)
        : path.includes('/pitangaBalance/') ? opts.balance
        : path.endsWith('/' + awardId) ? opts.award : undefined;
      return { exists: data !== undefined, data: () => data };
    },
    create: (target: any, data: unknown) => { writes.push({ path: target.path, data }); },
  };
  return { tx, writes };
};

test('clean baseline creates exactly one balance and one welcome ledger entry', async () => {
  const { tx, writes } = harness();
  assert.deepEqual(await grantCleanBaselineWelcomeInTransaction(tx, inputs()), { balance: 100, replay: false });
  assert.equal(writes.length, 2);
  assert.equal(writes[0].path, `users/${uid}/pitangaBalance/balance`);
  assert.equal((writes[0].data as any).availableKCoins, 100);
  assert.equal(writes[1].path, `users/${uid}/rewardLedger/${awardId}`);
});

test('clean baseline replays an existing award without writes', async () => {
  const { tx, writes } = harness({ balance: { userId: uid, availableKCoins: 1250 }, ledger: true, award });
  assert.deepEqual(await grantCleanBaselineWelcomeInTransaction(tx, inputs()), { balance: 1250, replay: true });
  assert.deepEqual(writes, []);
});

test('clean baseline refuses pre-existing balances and ledgers', async () => {
  for (const options of [
    { balance: { userId: uid, availableKCoins: 0 } },
    { ledger: true },
    { award: { ...award, deltaKCoins: 500 }, balance: { userId: uid, availableKCoins: 500 } },
  ]) {
    const { tx, writes } = harness(options);
    await assert.rejects(grantCleanBaselineWelcomeInTransaction(tx, inputs()), /NOT_EMPTY|REPLAY_CONFLICT/);
    assert.deepEqual(writes, []);
  }
});

test('clean baseline rejects historical accounts, missing isolation and forged receipts', async () => {
  for (const changed of [
    { campaignEffectiveAt: '2026-11-13T00:00:00.000Z' },
    { isolatedCleanBaseline: false },
  ]) {
    const { tx, writes } = harness();
    await assert.rejects(grantCleanBaselineWelcomeInTransaction(tx, inputs(changed)), /CLEAN_BASELINE_UNVERIFIED/);
    assert.deepEqual(writes, []);
  }
  const { tx, writes } = harness({ receipt: { ...receipt, issuer: 'client' } });
  await assert.rejects(grantCleanBaselineWelcomeInTransaction(tx, inputs()), /RECEIPT_INVALID/);
  assert.deepEqual(writes, []);
});

test('signed session cannot bypass invalid trusted receipt', async () => {
  const { tx, writes } = harness({ receipt: { ...receipt, issuer: 'client' } });
  await assert.rejects(grantCleanBaselineWelcomeInTransaction(tx, inputs()), /RECEIPT_INVALID/);
  assert.equal(writes.length, 0);
});

test('signed-session replay does not issue a second welcome award', async () => {
  const { tx, writes } = harness({
    balance: { userId: uid, availableKCoins: 1200 }, ledger: true, award,
  });
  assert.deepEqual(await grantCleanBaselineWelcomeInTransaction(tx, inputs({
    
  })), { balance: 1200, replay: true });
  assert.equal(writes.length, 0);
});

test('signed-session path refuses existing unrelated Pitanga history', async () => {
  for (const options of [
    { balance: { userId: uid, availableKCoins: 10 } },
    { ledger: true },
  ]) {
    const { tx, writes } = harness(options);
    await assert.rejects(grantCleanBaselineWelcomeInTransaction(tx, inputs({
      
    })), /WELCOME_CLEAN_BASELINE_NOT_EMPTY/);
    assert.equal(writes.length, 0);
  }
});

test('transaction rejects account created before campaign', async () => {
  const { tx, writes } = harness();
  await assert.rejects(grantCleanBaselineWelcomeInTransaction(tx, inputs({
    campaignEffectiveAt: '2026-11-13T00:00:00.000Z',
  })), /WELCOME_CLEAN_BASELINE_UNVERIFIED/);
  assert.deepEqual(writes, []);
});

test('two concurrent welcome requests serialize to one credit and one ledger entry', async () => {
  const documents = new Map<string, any>();
  let version = 0;
  const run = async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const startVersion = version;
      const pending: { path: string; data: any }[] = [];
      const tx: any = {
        get: async (target: any) => {
          if (target.query === 'ledger') {
            return { empty: ![...documents.keys()].some(path => path.startsWith(`users/${uid}/rewardLedger/`)) };
          }
          const data = documents.get(target.path);
          return { exists: data !== undefined, data: () => data };
        },
        create: (target: any, data: any) => pending.push({ path: target.path, data }),
      };
      // A signed initial session is verified by the trusted service before this call.
      const result = await grantCleanBaselineWelcomeInTransaction(tx, inputs({
        
      }));
      // Simulate Firestore's optimistic transaction conflict and retry.
      if (version !== startVersion) continue;
      for (const write of pending) {
        if (documents.has(write.path)) throw Error('duplicate document creation');
        documents.set(write.path, write.data);
      }
      version++;
      return result;
    }
    throw Error('transaction retries exhausted');
  };
  const results = await Promise.all([run(), run()]);
  assert.equal(results.filter(result => !result.replay).length, 1);
  assert.equal(results.filter(result => result.replay).length, 1);
  assert.equal(documents.size, 2);
  assert.equal(documents.get(`users/${uid}/pitangaBalance/balance`)?.availableKCoins, 100);
  assert.equal(documents.get(`users/${uid}/rewardLedger/${awardId}`)?.deltaKCoins, 100);
});
