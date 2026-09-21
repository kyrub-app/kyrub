import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseFiscalHomologationPolicyDraft,
  resolveFiscalHomologationPolicy,
  validateFiscalHomologationPolicyForApproval,
} from '../shared/fiscalHomologationPolicy';

test('fiscal homologation policy starts incomplete without inventing tax choices', () => {
  const resolution = resolveFiscalHomologationPolicy({
    policyId: 'policy-1',
    storeId: 'store-1',
  });

  assert.equal(resolution.resolutionStatus, 'draft_incomplete');
  assert.equal(resolution.policy.status, 'draft');
  assert.equal(resolution.policy.documentFamily, null);
  assert.equal(resolution.policy.operationalTrigger, null);
  assert.equal(resolution.policy.operationScope, null);
  assert.equal(resolution.policy.environment, 'sandbox');
  assert.equal(resolution.executableInProduction, false);
  assert.equal(resolution.emissionAuthority, 'none_homologation_only');
  assert.equal(resolution.providerCallAllowed, false);
  assert.equal(resolution.sefazCallAllowed, false);
  assert.deepEqual(resolution.missingInputs, [
    'policy_reference',
    'effective_from',
    'operation_scope',
    'document_family',
    'operational_trigger',
  ]);
});

test('explicit policy choices can become ready only for homologation', () => {
  const resolution = validateFiscalHomologationPolicyForApproval({
    policyId: 'policy-2',
    storeId: 'store-1',
    version: 3,
    policyReference: 'contador/parecer-2026-09',
    effectiveFrom: '2026-10-01T00:00:00-03:00',
    operationScope: 'goods',
    documentFamily: 'nfce',
    operationalTrigger: 'payment_confirmed',
  });

  assert.equal(resolution.resolutionStatus, 'ready_for_homologation');
  assert.equal(resolution.policy.status, 'approved_for_homologation');
  assert.equal(resolution.policy.documentFamily, 'nfce');
  assert.equal(resolution.policy.operationalTrigger, 'payment_confirmed');
  assert.equal(resolution.policy.version, 3);
  assert.equal(resolution.policy.environment, 'sandbox');
  assert.equal(resolution.executableInProduction, false);
  assert.equal(resolution.emissionAuthority, 'none_homologation_only');
  assert.equal(resolution.providerCallAllowed, false);
  assert.equal(resolution.sefazCallAllowed, false);
});

test('approval rejects incomplete explicit policy', () => {
  assert.throws(
    () => validateFiscalHomologationPolicyForApproval({
      policyId: 'policy-3',
      storeId: 'store-1',
      policyReference: 'contador/parecer-2026-09',
      effectiveFrom: '2026-10-01T00:00:00-03:00',
      operationScope: 'service',
      documentFamily: 'nfse',
    }),
    /FISCAL_HOMOLOGATION_POLICY_INCOMPLETE:operational_trigger/
  );
});

test('parser discards unsupported policy values instead of inferring replacements', () => {
  const parsed = parseFiscalHomologationPolicyDraft({
    policyId: 'policy-4',
    storeId: 'store-1',
    status: 'approved_for_homologation',
    policyReference: ' referência ',
    effectiveFrom: 'not-a-date',
    operationScope: 'goods',
    documentFamily: 'nfse',
    operationalTrigger: 'payment_confirmed',
  });

  assert.equal(parsed.policyReference, 'referência');
  assert.equal(parsed.effectiveFrom, null);
  assert.equal(parsed.environment, 'sandbox');
});

test('policy identifiers are required and structurally constrained', () => {
  assert.throws(
    () => parseFiscalHomologationPolicyDraft({ policyId: '', storeId: 'store-1' }),
    /FISCAL_HOMOLOGATION_POLICY_ID_INVALID/
  );
  assert.throws(
    () => parseFiscalHomologationPolicyDraft({ policyId: 'policy-1', storeId: 'store/invalid' }),
    /FISCAL_HOMOLOGATION_POLICY_STORE_INVALID/
  );
});
