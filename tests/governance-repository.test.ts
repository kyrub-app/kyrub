import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('governance repository keeps lifecycle and consent writes server-authoritative', () => {
  const source = readFileSync('server/governance/governanceRepository.ts', 'utf8');
  assert.match(source, /governanceDocuments\/\$\{id\}/);
  assert.match(source, /users\/\$\{userId\}\/governanceConsents\/\$\{consentId\}/);
  assert.match(source, /assertGovernanceTransition/);
  assert.match(source, /assertVersionedConsentMatchesDocument/);
  assert.match(source, /document\.status !== 'published'/);
  assert.match(source, /FieldValue\.serverTimestamp\(\)/);
});
