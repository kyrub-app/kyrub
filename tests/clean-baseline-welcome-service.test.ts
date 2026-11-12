import test from 'node:test';
import assert from 'node:assert/strict';
import { grantCleanBaselineWelcomeForVerifiedUser } from '../server/gamification/cleanBaselineWelcomeService.js';

const uid = 'new_user_1';
const createdAt = '2026-11-12T12:00:00.000Z';
const occurredAt = '2026-11-12T12:00:01.000Z';
const previous = {
  enabled: process.env.KYRUB_PITANGA_CLEAN_BASELINE_ENABLED,
  isolated: process.env.KYRUB_PITANGA_CLEAN_BASELINE_ISOLATED,
  cutoff: process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT,
};
const restore = () => {
  for (const [key, value] of Object.entries({
    KYRUB_PITANGA_CLEAN_BASELINE_ENABLED: previous.enabled,
    KYRUB_PITANGA_CLEAN_BASELINE_ISOLATED: previous.isolated,
    KYRUB_WELCOME_BONUS_EFFECTIVE_AT: previous.cutoff,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};
const configure = () => {
  process.env.KYRUB_PITANGA_CLEAN_BASELINE_ENABLED = 'true';
  process.env.KYRUB_PITANGA_CLEAN_BASELINE_ISOLATED = 'true';
  process.env.KYRUB_WELCOME_BONUS_EFFECTIVE_AT = '2026-11-12T00:00:00.000Z';
};
const ref = (path: string): any => ({
  path, id: path.split('/').at(-1),
  collection: (name: string) => ({
    path: path + '/' + name,
    limit: () => ({ query: 'ledger' }),
    doc: (id: string) => ref(path + '/' + name + '/' + id),
  }),
});
const receipt = {
  userId: uid, eventType: 'first_login', schemaVersion: 1,
  issuer: 'trusted_auth_server', firebaseCreatedAt: createdAt, occurredAt,
};
const harness = (options: { existingBalance?: unknown; existingLedger?: boolean; receipt?: unknown; disabled?: boolean; creationTime?: string } = {}) => {
  const writes: string[] = [];
  const auth = {
    getUser: async () => ({ uid, disabled: options.disabled ?? false, metadata: { creationTime: options.creationTime ?? createdAt } }),
  };
  const db = {
    collection: (name: string) => ({ doc: (id: string) => ref(name + '/' + id) }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => fn({
      get: async (target: any) => {
        if (target.query === 'ledger') return { empty: !(options.existingLedger ?? false) };
        const data = target.path.endsWith('/authEvents/first_login_v1') ? (options.receipt ?? receipt)
          : target.path.endsWith('/pitangaBalance/balance') ? options.existingBalance
          : undefined;
        return { exists: data !== undefined, data: () => data };
      },
      create: (target: any) => writes.push(target.path),
    }),
  };
  return { auth: auth as any, db: db as any, writes };
};

test('clean baseline service remains disabled unless both isolation flags are enabled', async () => {
  try {
    configure();
    delete process.env.KYRUB_PITANGA_CLEAN_BASELINE_ISOLATED;
    const { db, auth, writes } = harness();
    await assert.rejects(grantCleanBaselineWelcomeForVerifiedUser(db, auth, uid), /CLEAN_BASELINE_DISABLED/);
    assert.deepEqual(writes, []);
  } finally { restore(); }
});

test('clean baseline service credits a new authenticated account with verified receipt', async () => {
  try {
    configure();
    const { db, auth, writes } = harness();
    assert.deepEqual(await grantCleanBaselineWelcomeForVerifiedUser(db, auth, uid), { balance: 1000, replay: false });
    assert.deepEqual(writes, [
      `users/${uid}/pitangaBalance/balance`,
      `users/${uid}/rewardLedger/earn_first_login_welcome_v1`,
    ]);
  } finally { restore(); }
});

test('clean baseline service rejects historical or disabled accounts and existing balances', async () => {
  try {
    configure();
    for (const options of [
      { creationTime: '2026-11-11T12:00:00.000Z' },
      { disabled: true },
      { existingBalance: { userId: uid, availableKCoins: 0 } },
    ]) {
      const { db, auth, writes } = harness(options);
      await assert.rejects(grantCleanBaselineWelcomeForVerifiedUser(db, auth, uid), /USER_INELIGIBLE|NOT_EMPTY/);
      assert.deepEqual(writes, []);
    }
  } finally { restore(); }
});
