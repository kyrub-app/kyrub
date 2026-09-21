import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './fiscal-homologation-policy-api.test';

const registrySource = readFileSync(
  'server/integrations/fiscalHomologationPolicyRegistry.ts',
  'utf8'
);

test('homologation policy registry resolves the canonical store from the authenticated tenant', () => {
  assert.match(registrySource, /tenants\/\$\{tenantId\}/);
  assert.match(registrySource, /canonicalStoreId/);
  assert.match(registrySource, /tenantId !== requestedByUserId/);
  assert.match(registrySource, /STORE_CONNECTION_FORBIDDEN/);
});

test('policy registry writes current state and an immutable revision atomically', () => {
  assert.match(registrySource, /runTransaction/);
  assert.match(registrySource, /fiscalPolicies\/homologation/);
  assert.match(registrySource, /revisions\/v\$\{String\(version\)\.padStart\(6, '0'\)\}/);
  assert.match(registrySource, /transaction\.set\(currentRef, stored\)/);
  assert.match(registrySource, /transaction\.create/);
  assert.match(registrySource, /FieldValue\.serverTimestamp\(\)/);
});

test('browser-controlled policy input cannot set store identity, version, environment or emission authority', () => {
  const inputBlock = registrySource.slice(
    registrySource.indexOf('export interface SaveFiscalHomologationPolicyInput'),
    registrySource.indexOf('const parseStoredRecord')
  );

  assert.doesNotMatch(inputBlock, /canonicalStoreId/);
  assert.doesNotMatch(inputBlock, /policyId/);
  assert.doesNotMatch(inputBlock, /version/);
  assert.doesNotMatch(inputBlock, /environment/);
  assert.doesNotMatch(inputBlock, /emissionAuthority/);
  assert.doesNotMatch(inputBlock, /providerCallAllowed/);
  assert.doesNotMatch(inputBlock, /sefazCallAllowed/);
});

test('approval always passes through the pure homologation policy validator', () => {
  assert.match(registrySource, /approveForHomologation === true/);
  assert.match(registrySource, /validateFiscalHomologationPolicyForApproval/);
  assert.match(registrySource, /resolveFiscalHomologationPolicy/);
});

test('policy registry has no fiscal provider or SEFAZ side effect', () => {
  assert.doesNotMatch(registrySource, /fetch\s*\(/);
  assert.doesNotMatch(registrySource, /mercadoLivre|99food|ninetyNineFood/i);
  assert.doesNotMatch(registrySource, /sefaz.*request|request.*sefaz/i);
});
