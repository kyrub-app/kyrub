import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(
  new URL('../scripts/bootstrap-first-super-admin.mjs', import.meta.url),
  'utf8'
);
const packageJson = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8')
) as { scripts?: Record<string, string> };

test('first super admin bootstrap is fixed to the Kyrub project and dry-run by default', () => {
  assert.match(script, /EXPECTED_PROJECT_ID = 'kyrub-b8d0e'/);
  assert.match(script, /const result = \{ apply: false \}/);
  assert.match(script, /--confirm-project/);
  assert.match(script, /CREATE-FIRST-SUPER-ADMIN/);
});

test('bootstrap validates the Firebase Auth identity before any Firestore write', () => {
  assert.match(script, /identitytoolkit\.googleapis\.com/);
  assert.match(script, /accounts:lookup/);
  assert.match(script, /localId: \[uid\]/);
  assert.match(script, /account\.emailVerified !== true/);
  assert.match(script, /authEmail !== email/);
});

test('bootstrap prevents duplicate super admins and commits lock profile and audit atomically', () => {
  assert.match(script, /collectionId: 'admins'/);
  assert.match(script, /stringValue: 'super_admin'/);
  assert.match(script, /bootstrap\/first_super_admin/);
  assert.match(script, /documents:commit/);
  assert.match(script, /JSON\.stringify\(\{ writes \}\)/);
  assert.equal((script.match(/currentDocument: \{ exists: false \}/g) ?? []).length, 3);
});

test('bootstrap resolves the Windows gcloud command without requiring a permanent PATH edit', () => {
  assert.match(script, /resolveGcloudExecutable/);
  assert.match(script, /ProgramFiles\(x86\)/);
  assert.match(script, /existsSync\(candidate\)/);
  assert.match(script, /shell: process\.platform === 'win32'/);
});

test('bootstrap does not embed long-lived credentials or mutate Firebase rules', () => {
  assert.doesNotMatch(script, /private_key/i);
  assert.doesNotMatch(script, /serviceAccountKey/i);
  assert.doesNotMatch(script, /GOOGLE_APPLICATION_CREDENTIALS/);
  assert.doesNotMatch(script, /firestore\.rules/);
  assert.match(script, /application-default/);
});

test('bootstrap command and regression test remain part of the project contract', () => {
  assert.equal(
    packageJson.scripts?.['admin:bootstrap:first-super-admin'],
    'node scripts/bootstrap-first-super-admin.mjs'
  );
  assert.match(packageJson.scripts?.prebuild ?? '', /tests\/admin-bootstrap\.test\.ts/);
});
