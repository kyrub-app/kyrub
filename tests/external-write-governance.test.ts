import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  EXTERNAL_WRITE_GOVERNANCE_POLICY,
  canAdvanceExternalWriteBaseline,
  classifyExternalWriteContinuation,
  evaluateExternalWriteAttempt,
  type ExternalWriteAttemptContext,
  type ExternalWriteAuthorizationBinding,
  type ExternalWriteTargetScope,
} from '../shared/externalWriteGovernance.js';

const mercadoLivreScope: ExternalWriteTargetScope = {
  storeId: 'store-1',
  channel: 'mercado_livre',
  operationKind: 'catalog.bound_listing.price_update',
  proposalId: 'mlupd_test',
  targetRef: 'MLB123456789',
};

const mercadoLivreAuthorization: ExternalWriteAuthorizationBinding = {
  ...mercadoLivreScope,
  authorizationId: 'mlupdauth_test',
  authoritySource: 'explicit_user_authorization',
  authorizedFields: ['price'],
  protectedFields: ['stock', 'category', 'image', 'publicationStatus'],
  revalidatedImmediatelyBeforeWrite: true,
  consumptionStatus: 'available',
};

const attempt = (
  overrides: Partial<ExternalWriteAttemptContext> = {}
): ExternalWriteAttemptContext => ({
  request: mercadoLivreScope,
  authorization: mercadoLivreAuthorization,
  userSignal: 'explicit_authorization',
  providerWriteAttempted: false,
  reconciled: false,
  ...overrides,
});

test('external write governance policy keeps local save, generic confirmation and fanout outside provider authority', () => {
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.localPersistenceGrantsAuthority, false);
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.genericConfirmationGrantsAuthority, false);
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.authorizationMode, 'explicit_one_time_revalidated');
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.crossChannelFanout, 'forbidden');
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.retryAfterProviderWriteAttempt, 'reconciliation_only_no_blind_retry');
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.reconciliationMode, 'provider_readback_required');
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.baselineAdvance, 'exact_target_observed_and_reconciled_only');
  assert.equal(EXTERNAL_WRITE_GOVERNANCE_POLICY.providerStateAuthority, 'external_channel_only_not_inventory');
});

test('one exact explicit revalidated authorization can pass the provider-write gate', () => {
  assert.deepEqual(evaluateExternalWriteAttempt(attempt()), {
    allowed: true,
    code: 'ALLOWED',
  });
});

test('local persistence and generic conversational confirmation never grant external authority', () => {
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ userSignal: 'local_persistence' })),
    { allowed: false, code: 'LOCAL_PERSISTENCE_NOT_AUTHORITY' }
  );
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ userSignal: 'generic_confirmation' })),
    { allowed: false, code: 'GENERIC_CONFIRMATION_NOT_AUTHORITY' }
  );
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ authorization: null })),
    { allowed: false, code: 'EXPLICIT_AUTHORIZATION_REQUIRED' }
  );
});

test('authorization cannot fan out across channel, operation, proposal or target boundaries', () => {
  for (const request of [
    { ...mercadoLivreScope, channel: '99food' },
    { ...mercadoLivreScope, operationKind: 'order.status_transition' },
    { ...mercadoLivreScope, proposalId: 'other-proposal' },
    { ...mercadoLivreScope, targetRef: 'other-target' },
  ]) {
    assert.deepEqual(
      evaluateExternalWriteAttempt(attempt({ request })),
      { allowed: false, code: 'AUTHORIZATION_SCOPE_MISMATCH' }
    );
  }
});

test('authorized field scope must be explicit, non-wildcard and disjoint from protected fields', () => {
  const authorize = (authorizedFields: string[], protectedFields = mercadoLivreAuthorization.protectedFields) =>
    ({ ...mercadoLivreAuthorization, authorizedFields, protectedFields });

  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ authorization: authorize([]) })),
    { allowed: false, code: 'AUTHORIZED_FIELDS_REQUIRED' }
  );
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ authorization: authorize(['*']) })),
    { allowed: false, code: 'AUTHORIZED_FIELD_WILDCARD_FORBIDDEN' }
  );
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ authorization: authorize(['price', 'stock']) })),
    { allowed: false, code: 'AUTHORIZED_PROTECTED_FIELD_OVERLAP' }
  );
});

test('authorization must be revalidated immediately, available once and never replayed after a provider attempt', () => {
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({
      authorization: { ...mercadoLivreAuthorization, revalidatedImmediatelyBeforeWrite: false },
    })),
    { allowed: false, code: 'IMMEDIATE_REVALIDATION_REQUIRED' }
  );
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({
      authorization: { ...mercadoLivreAuthorization, consumptionStatus: 'consumed' },
    })),
    { allowed: false, code: 'AUTHORIZATION_NOT_AVAILABLE' }
  );
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ providerWriteAttempted: true })),
    { allowed: false, code: 'PROVIDER_WRITE_ALREADY_ATTEMPTED' }
  );
  assert.deepEqual(
    evaluateExternalWriteAttempt(attempt({ reconciled: true })),
    { allowed: false, code: 'ALREADY_RECONCILED' }
  );
});

test('after any provider write attempt, continuation is reconciliation-only and baseline advances only after exact readback', () => {
  assert.equal(classifyExternalWriteContinuation({
    providerWriteAttempted: false,
    exactTargetObserved: false,
    reconciliationPersisted: false,
  }), 'ready_for_authorization_gate');

  assert.equal(classifyExternalWriteContinuation({
    providerWriteAttempted: true,
    exactTargetObserved: false,
    reconciliationPersisted: false,
  }), 'reconciliation_required');

  assert.equal(classifyExternalWriteContinuation({
    providerWriteAttempted: true,
    exactTargetObserved: true,
    reconciliationPersisted: false,
  }), 'reconciliation_required');

  assert.equal(classifyExternalWriteContinuation({
    providerWriteAttempted: true,
    exactTargetObserved: true,
    reconciliationPersisted: true,
  }), 'reconciled');

  assert.equal(canAdvanceExternalWriteBaseline({
    providerWriteAttempted: true,
    exactTargetObserved: true,
    reconciliationPersisted: true,
  }), true);
  assert.equal(canAdvanceExternalWriteBaseline({
    providerWriteAttempted: true,
    exactTargetObserved: false,
    reconciliationPersisted: true,
  }), false);
});

test('existing Mercado Livre and 99Food flows expose compatible authority boundaries without sharing provider payloads', async () => {
  const [mlAuthorization, mlExecution, mlReconciliation, foodAuthority] = await Promise.all([
    readFile(new URL('../server/integrations/mercadoLivreBoundListingUpdateAuthorizationService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/integrations/mercadoLivreBoundListingUpdateExecutionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/integrations/mercadoLivreBoundListingUpdateReconciliationService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/utils/ninetyNineFoodStatusWriteAuthority.ts', import.meta.url), 'utf8'),
  ]);

  assert.match(mlAuthorization, /consumptionStatus:\s*'available'/);
  assert.match(mlAuthorization, /providerObservedHash/);
  assert.match(mlExecution, /AUTHORIZATION_ALREADY_CONSUMED/);
  assert.match(mlExecution, /providerBefore/);
  assert.match(mlReconciliation, /providerMatchesAuthorizedTarget/);
  assert.match(mlReconciliation, /alreadyReconciled/);

  assert.match(foodAuthority, /'kyrub_only'/);
  assert.match(foodAuthority, /'kyrub_and_99food'/);
  assert.match(foodAuthority, /pendingAuthority/);
  assert.match(foodAuthority, /provider write foi autorizado/);

  assert.doesNotMatch(mlAuthorization, /kyrub_and_99food/);
  assert.doesNotMatch(foodAuthority, /mercado_livre/);
});
