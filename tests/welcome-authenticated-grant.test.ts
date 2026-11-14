import test from 'node:test';
import assert from 'node:assert/strict';
import { grantWelcomeFromFirebaseIdToken } from '../server/gamification/welcomeAuthenticatedGrant.js';

const withFlag = async (value: string | undefined, run: () => Promise<void>) => {
  const prior = process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED;
  try {
    if (value === undefined) delete process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED;
    else process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED = value;
    await run();
  } finally {
    if (prior === undefined) delete process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED;
    else process.env.KYRUB_PITANGA_SIGNED_SESSION_WELCOME_ENABLED = prior;
  }
};

test('server boundary is disabled by default without reading Firebase or accepting client token', async () => {
  await withFlag(undefined, async () => {
    await assert.rejects(
      grantWelcomeFromFirebaseIdToken({} as never, {} as never, 'malicious-token'),
      /WELCOME_SIGNED_SESSION_DISABLED/,
    );
  });
});

test('enabled flag without verified Firebase project fails before token parsing or DB access', async () => {
  const old = process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID;
  try {
    delete process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID;
    await withFlag('true', async () => {
      await assert.rejects(
        grantWelcomeFromFirebaseIdToken({} as never, { app: { options: { projectId: 'kyrub-security-test' } } } as never, 'malicious-token'),
        /WELCOME_FIREBASE_PROJECT_MISMATCH/,
      );
    });
  } finally {
    if (old === undefined) delete process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID;
    else process.env.KYRUB_PITANGA_WELCOME_PROJECT_ID = old;
  }
});
