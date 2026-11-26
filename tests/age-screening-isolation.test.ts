import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageScreeningEmulatorsReady } from '../server/identity/ageScreeningIsolation.js';
import { getOwnAgeStatus, submitOwnAgeScreening } from '../server/identity/ageEligibilityService.js';
test('age screening requires dedicated local project, both emulators and explicit opt-in', () => {
  const env = { NODE_ENV:'test', KYRUB_AGE_SCREENING_EMULATOR:'true',
    GCLOUD_PROJECT:'demo-kyrub-onboarding', FIREBASE_PROJECT_ID:'demo-kyrub-onboarding',
    FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099', FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088' };
  assert.equal(ageScreeningEmulatorsReady(env), true);
  for (const key of Object.keys(env)) assert.equal(ageScreeningEmulatorsReady({...env,[key]:''}),false);
  for (const key of ['GOOGLE_CLOUD_PROJECT','VERCEL','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS'])
    assert.equal(ageScreeningEmulatorsReady({...env,[key]:'unexpected'}),false);
});
test('direct service call is denied before Firebase access without emulator opt-in', async () => {
  const old = process.env.KYRUB_AGE_SCREENING_EMULATOR;
  delete process.env.KYRUB_AGE_SCREENING_EMULATOR;
  try {
    await assert.rejects(getOwnAgeStatus('Bearer example'), /AGE_EMULATOR_REQUIRED/);
    await assert.rejects(submitOwnAgeScreening('Bearer example', {}), /AGE_EMULATOR_REQUIRED/);
  } finally {
    if (old !== undefined) process.env.KYRUB_AGE_SCREENING_EMULATOR = old;
  }
});
