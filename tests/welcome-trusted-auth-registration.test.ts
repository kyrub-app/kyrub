import test from 'node:test';
import assert from 'node:assert/strict';
import { recordWelcomeRegistrationFromTrustedAuthTrigger } from '../server/gamification/welcomeTrustedAuthRegistration.js';

const projectId = 'welcome-test-project';
const uid = 'first_google_user';
const createdAt = '2026-11-14T12:00:00.000Z';
const event = { uid, metadata: { creationTime: createdAt }, providerData: [{ providerId: 'google.com' }] };
const context = { eventId: 'firebase-auth-create-event-1', projectId };

const harness = () => {
  const documents = new Map<string, any>();
  let transactions = 0;
  const db = {
    doc: (path: string) => ({ path }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      transactions++;
      const writes: Array<{ path: string; data: unknown }> = [];
      const result = await fn({
        get: async (ref: { path: string }) => ({
          exists: documents.has(ref.path),
          data: () => documents.get(ref.path),
        }),
        create: (ref: { path: string }, data: unknown) => writes.push({ path: ref.path, data }),
      });
      for (const write of writes) {
        if (documents.has(write.path)) throw Error('DUPLICATE_RECEIPT');
        documents.set(write.path, write.data);
      }
      return result;
    },
  };
  return { db: db as never, documents, count: () => transactions };
};

const withProject = async (run: () => Promise<void>) => {
  const previous = process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID;
  process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID = projectId;
  try { await run(); } finally {
    if (previous === undefined) delete process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID;
    else process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID = previous;
  }
};

test('trusted Firebase Auth creation event creates immutable receipt and replays once', async () => {
  await withProject(async () => {
    const h = harness();
    assert.deepEqual(await recordWelcomeRegistrationFromTrustedAuthTrigger(h.db, event, context), { recorded: true });
    assert.deepEqual(await recordWelcomeRegistrationFromTrustedAuthTrigger(h.db, event, context), { recorded: false });
    assert.equal(h.documents.size, 1);
    assert.equal(h.documents.get(`users/${uid}/authEvents/first_login_v1`).sourceEventId, context.eventId);
  });
});

test('rejects wrong project, non-Google registration and invalid trigger event IDs before writes', async () => {
  await withProject(async () => {
    for (const [candidate, trigger] of [
      [event, { ...context, projectId: 'another-project' }],
      [{ ...event, providerData: [{ providerId: 'password' }] }, context],
      [{ ...event, providerData: [] }, context],
      [event, { ...context, eventId: 'short' }],
    ] as const) {
      const h = harness();
      await assert.rejects(recordWelcomeRegistrationFromTrustedAuthTrigger(h.db, candidate, trigger));
      assert.equal(h.count(), 0);
      assert.equal(h.documents.size, 0);
    }
  });
});

test('conflicting source event cannot replace first registration receipt', async () => {
  await withProject(async () => {
    const h = harness();
    await recordWelcomeRegistrationFromTrustedAuthTrigger(h.db, event, context);
    await assert.rejects(
      recordWelcomeRegistrationFromTrustedAuthTrigger(h.db, event, { ...context, eventId: 'firebase-auth-create-event-2' }),
      /WELCOME_FIRST_LOGIN_RECEIPT_CONFLICT/,
    );
    assert.equal(h.documents.size, 1);
  });
});
