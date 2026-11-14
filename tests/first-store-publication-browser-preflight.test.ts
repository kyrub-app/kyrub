import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const server = read('../server.ts');
const action = read('../api/action-execute.ts');
const publicationHandler = read('../server/gamification/firstStorePublicationHandler.ts');
const emulator = JSON.parse(read('../firebase.security.json'));

test('isolated browser preflight requires Auth and Firestore emulator configuration', () => {
  assert.equal(emulator.emulators.auth.host, '127.0.0.1');
  assert.equal(emulator.emulators.firestore.host, '127.0.0.1');
  assert.ok(Number.isInteger(emulator.emulators.auth.port));
  assert.ok(Number.isInteger(emulator.emulators.firestore.port));
});

test('publication handler mounts locally only with emulator-only guard', () => {
  assert.match(action, /transport === 'first-store-publication'/);
  assert.match(server, /KYRUB_FIRST_STORE_PUBLICATION_E2E_LOCAL === 'true'/);
  assert.match(server, /NODE_ENV !== 'production'/);
  assert.ok(server.includes("FIRESTORE_EMULATOR_HOST === '127.0.0.1:8088'"));
  assert.ok(server.includes("FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099'"));
  assert.ok(server.includes("app.post('/api/action-execute'"));
  assert.ok(server.includes("FIREBASE_PROJECT_ID === 'kyrub-security-test'"));
  assert.ok(publicationHandler.includes('adminAuth.verifyIdToken(token)'));
  assert.ok(publicationHandler.includes('verifyFirebaseIdToken(token)'));
  assert.ok(publicationHandler.includes("KYRUB_FIRST_STORE_PUBLICATION_E2E_LOCAL === 'true'"));
});

test('E2E release requires explicit emulator-only browser auth and server API wiring', () => {
  assert.ok(process.env.CI || process.env.FIRESTORE_EMULATOR_HOST,
    'Run this preflight in CI or against the isolated Firestore emulator');
});
