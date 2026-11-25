import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageScreeningEmulatorsReady } from '../server/identity/ageScreeningRouter.js';

test('age screening requires both local emulators, dedicated project and opt-in', () => {
  const env = { NODE_ENV:'test', KYRUB_AGE_SCREENING_EMULATOR:'true',
    GCLOUD_PROJECT:'demo-kyrub-onboarding', FIREBASE_PROJECT_ID:'demo-kyrub-onboarding',
    FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099', FIRESTORE_EMULATOR_HOST:'127.0.0.1:8088' };
  assert.equal(ageScreeningEmulatorsReady(env),true);
  for(const key of Object.keys(env)) assert.equal(ageScreeningEmulatorsReady({...env,[key]:''}),false);
  for(const key of ['GOOGLE_CLOUD_PROJECT','VERCEL','FIREBASE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS'])
    assert.equal(ageScreeningEmulatorsReady({...env,[key]:'unexpected'}),false);
});
