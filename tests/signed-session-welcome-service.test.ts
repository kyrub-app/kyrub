import test from 'node:test';
import assert from 'node:assert/strict';
import { grantSignedSessionWelcomeForVerifiedUser } from '../server/gamification/signedSessionWelcomeService.js';

const createdAt = '2026-11-12T12:00:00.000Z';
const authTime = Date.parse('2026-11-12T12:00:30.000Z') / 1000;
const envKeys = [
  'KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED',
  'KYRUB_PITANGA_WELCOME_PROJECT_ID',
  'KYRUB_WELCOME_BONUS_EFFECTIVE_AT',
] as const;

const withEnv = async (values: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const before = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  try {
    for (const key of envKeys) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
    await fn();
  } finally {
    for (const key of envKeys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
};
const enabled = {
  KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED: 'true',
  KYRUB_PITANGA_WELCOME_PROJECT_ID: 'kyrub-test',
  KYRUB_WELCOME_BONUS_EFFECTIVE_AT: '2026-11-12T00:00:00.000Z',
};
const mock = (projectId = 'kyrub-test', userCreatedAt = createdAt, fenceData?: Record<string, unknown>) => {
  let lookups = 0;
  let transactions = 0;
  const auth = {
    app: { options: { projectId } },
    getUser: async (uid: string) => {
      lookups++;
      return { uid, disabled: false, metadata: { creationTime: userCreatedAt } };
    },
  };
  const db = {
    runTransaction: async (callback: (tx: any) => Promise<unknown>) => {
      transactions++;
      let reads = 0;
      const tx = { get: async () => {
        if (++reads > 1) throw Error('MOCK_TRANSACTION_STOP');
        return { exists: fenceData !== undefined, data: () => fenceData };
      } };
      try { await callback(tx); } catch (error) {
        if ((error as Error).message !== 'MOCK_TRANSACTION_STOP') throw error;
      }
      return { balance: 1000, replay: false };
    },
    doc: () => ({ path: 'systemControl/pitangaLegacyWriterFence' }),
    collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }),
  };
  return { auth: auth as any, db: db as any, counts: () => ({ lookups, transactions }) };
};

test('welcome campaign remains disabled by default, without Firebase reads', async () => {
  await withEnv({}, async () => {
    const m = mock();
    await assert.rejects(
      grantSignedSessionWelcomeForVerifiedUser(m.db, m.auth, 'new-user', 'new-user', authTime),
      /WELCOME_SIGNED_SESSION_DISABLED/,
    );
    assert.deepEqual(m.counts(), { lookups: 0, transactions: 0 });
  });
});

test('welcome grant refuses unexpected or unconfigured Firebase project before user reads', async () => {
  for (const projectId of ['other-project', '']) {
    await withEnv(enabled, async () => {
      const m = mock(projectId);
      await assert.rejects(
        grantSignedSessionWelcomeForVerifiedUser(m.db, m.auth, 'new-user', 'new-user', authTime),
        /WELCOME_FIREBASE_PROJECT_MISMATCH/,
      );
      assert.deepEqual(m.counts(), { lookups: 0, transactions: 0 });
    });
  }
});

test('welcome grant refuses mismatched token identity, historical account, and invalid auth_time', async () => {
  for (const scenario of [
    { tokenUid: 'someone-else', time: authTime, created: createdAt },
    { tokenUid: 'new-user', time: NaN, created: createdAt },
    { tokenUid: 'new-user', time: authTime, created: '2026-11-11T12:00:00.000Z' },
  ]) {
    await withEnv(enabled, async () => {
      const m = mock('kyrub-test', scenario.created);
      await assert.rejects(
        grantSignedSessionWelcomeForVerifiedUser(m.db, m.auth, 'new-user', scenario.tokenUid, scenario.time),
        /WELCOME_INITIAL_SESSION_/,
      );
      assert.equal(m.counts().transactions, 0);
    });
  }
});

test('eligible Firebase-signed session reaches one transaction only', async () => {
  await withEnv(enabled, async () => {
    const m = mock('kyrub-test', createdAt, { status: 'fenced', writersVerified: true, epoch: 'test-epoch' });
    assert.deepEqual(
      await grantSignedSessionWelcomeForVerifiedUser(m.db, m.auth, 'new-user', 'new-user', authTime),
      { balance: 1000, replay: false },
    );
    assert.deepEqual(m.counts(), { lookups: 1, transactions: 1 });
  });
});

test('welcome rejects absent or unverified legacy writer fence', async () => {
  for (const fence of [undefined, { status: 'open', writersVerified: true, epoch: 'e1' }, { status: 'fenced', writersVerified: false, epoch: 'e1' }]) {
    await withEnv(enabled, async () => {
      const m = mock('kyrub-test', createdAt, fence);
      await assert.rejects(grantSignedSessionWelcomeForVerifiedUser(m.db, m.auth, 'new-user', 'new-user', authTime), /WELCOME_LEGACY_WRITERS_NOT_VERIFIED/);
      assert.equal(m.counts().transactions, 1);
    });
  }
});
