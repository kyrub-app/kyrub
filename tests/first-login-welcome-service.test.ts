import test from 'node:test';
import assert from 'node:assert/strict';
import { awardFirstLoginWelcomeForVerifiedUser } from '../server/gamification/firstLoginWelcomeAwardService.js';

const uid = 'new_user_1';
const createdAt = '2026-11-12T12:00:00.000Z';
const occurredAt = '2026-11-12T12:00:01.000Z';
const oldCutoff = process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
const makeRef = (path: string): any => {
  const segments = path.split('/');
  return {
    path, id: segments.at(-1),
    parent: { path: segments.slice(0, -1).join('/') },
    collection: (name: string) => ({ doc: (id: string) => makeRef(`${path}/${name}/${id}`) }),
  };
};
function harness(receipt?: unknown, options: { existingLedger?: unknown; balance?: number; missingBalance?: boolean } = {}) {
  const writes: Array<{ op: string; path: string }> = [];
  const balance = { userId: uid, availableKCoins: options.balance ?? 0 };
  const db = {
    collection: (name: string) => ({ doc: (id: string) => makeRef(`${name}/${id}`) }),
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => callback({
      get: async (ref: any) => {
        if (ref.path.endsWith('/authEvents/first_login_v1')) {
          return { exists: receipt !== undefined, data: () => receipt };
        }
        if (ref.path.endsWith('/pitangaBalance/balance')) {
          return { exists: options.missingBalance !== true, data: () => balance };
        }
        if (ref.path.endsWith('/rewardLedger/earn_first_login_welcome_v1')) {
          return { exists: options.existingLedger !== undefined, data: () => options.existingLedger };
        }
        return { exists: false, data: () => undefined };
      },
      update: (ref: any) => { writes.push({ op: 'update', path: ref.path }); },
      create: (ref: any) => { writes.push({ op: 'create', path: ref.path }); },
    }),
  };
  const auth = { getUser: async () => ({ uid, disabled: false, metadata: { creationTime: createdAt } }) };
  return { db: db as any, auth: auth as any, writes };
}
const receipt = {
  userId: uid, eventType: 'first_login', schemaVersion: 1,
  issuer: 'trusted_auth_server', firebaseCreatedAt: createdAt, occurredAt,
};

test('welcome service rejects missing first-login receipt without any balance writes', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
  try {
    const { db, auth, writes } = harness();
    await assert.rejects(awardFirstLoginWelcomeForVerifiedUser(db, auth, uid), /RECEIPT_MISSING/);
    assert.deepEqual(writes, []);
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('welcome service checks receipt before recording a single canonical credit', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
  try {
    const { db, auth, writes } = harness(receipt);
    assert.deepEqual(await awardFirstLoginWelcomeForVerifiedUser(db, auth, uid), { balance: 1000, replay: false });
    assert.deepEqual(writes.map(x => x.op), ['update', 'create']);
    assert.ok(writes[0].path.endsWith('/pitangaBalance/balance'));
    assert.ok(writes[1].path.endsWith('/rewardLedger/earn_first_login_welcome_v1'));
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('welcome service rejects client-issued and mismatched receipts without credits', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
  try {
    for (const invalid of [
      { ...receipt, issuer: 'client' },
      { ...receipt, userId: 'another_user' },
      { ...receipt, eventType: 'last_sign_in' },
      { ...receipt, occurredAt: '2026-11-13T12:00:02.000Z' },
    ]) {
      const { db, auth, writes } = harness(invalid);
      await assert.rejects(awardFirstLoginWelcomeForVerifiedUser(db, auth, uid), /RECEIPT_INVALID/);
      assert.deepEqual(writes, []);
    }
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('welcome service refuses historical users before reading receipts', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-13T00:00:00.000Z';
  try {
    const { db, auth, writes } = harness(receipt);
    await assert.rejects(awardFirstLoginWelcomeForVerifiedUser(db, auth, uid), /HISTORICAL_USER_NOT_ELIGIBLE/);
    assert.deepEqual(writes, []);
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('existing canonical welcome grant replays without a second credit', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
  try {
    const existingLedger = {
      id: 'earn_first_login_welcome_v1',
      userId: uid,
      type: 'earn',
      economy: 'k_coin',
      deltaKCoins: 1000,
      sourceType: 'campaign',
      sourceId: 'first_login_welcome_v1',
      correlationId: 'first_login_welcome_v1',
      idempotencyKey: 'pitanga_earn_first_login_welcome_v1',
      occurredAt,
    };
    const { db, auth, writes } = harness(receipt, { existingLedger, balance: 1350 });
    assert.deepEqual(await awardFirstLoginWelcomeForVerifiedUser(db, auth, uid), {
      balance: 1350, replay: true,
    });
    assert.deepEqual(writes, [], 'replaying an existing grant must not mutate the balance or ledger');
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('conflicting historical welcome ledger cannot be replayed or credited again', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
  try {
    const validLedger = {
      id: 'earn_first_login_welcome_v1',
      userId: uid,
      type: 'earn',
      economy: 'k_coin',
      deltaKCoins: 1000,
      sourceType: 'campaign',
      sourceId: 'first_login_welcome_v1',
      correlationId: 'first_login_welcome_v1',
      idempotencyKey: 'pitanga_earn_first_login_welcome_v1',
      occurredAt,
    };
    for (const changed of [
      { deltaKCoins: 2000 },
      { userId: 'other_user' },
      { sourceType: 'admin_adjustment' },
      { occurredAt: '2026-11-12T12:00:02.000Z' },
    ]) {
      const { db, auth, writes } = harness(receipt, {
        existingLedger: { ...validLedger, ...changed },
        balance: 1350,
      });
      await assert.rejects(
        awardFirstLoginWelcomeForVerifiedUser(db, auth, uid),
        /PITANGA_EARN_IDEMPOTENCY_CONFLICT/,
      );
      assert.deepEqual(writes, [], 'a conflicting ledger must not change balances');
    }
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('welcome credit cannot silently bootstrap a missing canonical balance', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
  try {
    const { db, auth, writes } = harness(receipt, { missingBalance: true });
    await assert.rejects(
      awardFirstLoginWelcomeForVerifiedUser(db, auth, uid),
      /PITANGA_EARN_BALANCE_UNAVAILABLE/,
    );
    assert.deepEqual(writes, [], 'missing balances must never be reset or credited implicitly');
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('welcome service rejects disabled Firebase accounts before any Firestore transaction', async () => {
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
  try {
    const { db, writes } = harness(receipt);
    let transactions = 0;
    const guardedDb = {
      ...db,
      runTransaction: async () => { transactions += 1; throw Error('TRANSACTION_SHOULD_NOT_RUN'); },
    } as any;
    const disabledAuth = {
      getUser: async () => ({ uid, disabled: true, metadata: { creationTime: createdAt } }),
    } as any;
    await assert.rejects(
      awardFirstLoginWelcomeForVerifiedUser(guardedDb, disabledAuth, uid),
      /WELCOME_AUTH_USER_INVALID/,
    );
    assert.equal(transactions, 0);
    assert.deepEqual(writes, []);
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});

test('welcome service remains disabled without server campaign cutoff', async () => {
  delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
  try {
    const { db, auth, writes } = harness(receipt);
    await assert.rejects(
      awardFirstLoginWelcomeForVerifiedUser(db, auth, uid),
      /WELCOME_CAMPAIGN_NOT_ENABLED/,
    );
    assert.deepEqual(writes, []);
  } finally {
    if (oldCutoff === undefined) delete process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT;
    else process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = oldCutoff;
  }
});
