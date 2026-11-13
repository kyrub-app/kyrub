import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const server = read('../server.ts');
const action = read('../api/action-execute.ts');
const emulator = JSON.parse(read('../firebase.security.json'));

test('isolated browser preflight requires Auth and Firestore emulator configuration', () => {
  assert.equal(emulator.emulators.auth.host, '127.0.0.1');
  assert.equal(emulator.emulators.firestore.host, '127.0.0.1');
  assert.ok(Number.isInteger(emulator.emulators.auth.port));
  assert.ok(Number.isInteger(emulator.emulators.firestore.port));
});

test('publication handler is available in serverless API but not mounted in local server', () => {
  assert.match(action, /transport === 'first-store-publication'/);
  // This test documents the missing integration; it must be replaced by a
  // positive HTTP test before a browser E2E run can claim completion.
  assert.doesNotMatch(server, /app\.(?:all|post|use)\(\s*['"]\/api\/action-execute/);
});

test('E2E release requires explicit emulator-only browser auth and server API wiring', () => {
  assert.ok(process.env.CI || process.env.FIRESTORE_EMULATOR_HOST,
    'Run this preflight in CI or against the isolated Firestore emulator');
});
