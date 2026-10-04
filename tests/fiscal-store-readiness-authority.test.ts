import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../server/fiscal/fiscalStoreReadinessService.ts', import.meta.url), 'utf8');

test('Fiscal readiness consumes the managed enrollment authority instead of a second direct enrollment path', () => {
  assert.match(source, /loadManagedFiscalStoreEnrollment/);
  assert.doesNotMatch(source, /kyrub_admin\/fiscal\/store_enrollments/);
});

test('managed enrollment lifecycle does not mint fiscal requirement evidence', () => {
  assert.match(source, /enrollment\.status === 'prepared'/);
  assert.match(source, /enrollment\.status === 'homologation_ready'/);
  assert.match(source, /enrollment\.status === 'production_authorized'/);
  assert.match(source, /evidence\.stateDocumentEnabled === true/);
  assert.match(source, /evidence\.certificateA1Configured === true/);
  assert.match(source, /evidence\.nfceCscConfigured === true/);
  assert.match(source, /evidence\.providerCompanyProvisioned === true/);
  assert.match(source, /evidence\.homologationApproved === true/);
});

test('readiness remains fail-closed for production traffic', () => {
  assert.match(source, /productionTrafficAllowed:\s*false/);
  assert.doesNotMatch(source, /productionTrafficAllowed:\s*true/);
});
