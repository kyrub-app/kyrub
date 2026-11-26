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

test('onboarding browser harness is opt-in, loopback-only and cannot mount the legacy APIs', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync('src/App.tsx','utf8');
  const firebase = readFileSync('src/utils/firebase.ts','utf8');
  const server = readFileSync('server/identity/onboardingPreviewServer.ts','utf8');
  const screen = readFileSync('src/components/OnboardingEmulatorEntry.tsx','utf8');
  assert.match(app,/import.meta.env.DEV && import.meta.env.VITE_KYRUB_ONBOARDING_EMULATOR === 'true'/);
  assert.ok(app.indexOf('return <OnboardingEmulatorEntry') < app.indexOf('const adminControlPlane ='));
  assert.match(firebase,/isolatedOnboarding \? 'demo-kyrub-onboarding'/);
  assert.match(firebase,/ONBOARDING_EMULATOR_PROJECT_MISMATCH/);
  assert.match(server,/ageScreeningEmulatorsReady\(process.env\)/);
  assert.match(server,/app.use\('\/api',\(_req,res\)=>res.sendStatus\(404\)\)/);
  assert.match(server,/listen\(Number\(process.env.PORT\|\|3000\),'127.0.0.1'\)/);
  assert.doesNotMatch(screen,/LegacyApp|setDoc\(|localStorage|sessionStorage/);
  assert.match(screen,/A triagem não comprova maioridade/);
});
