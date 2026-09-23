import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertFiscalHomologationAttemptStateTransition,
  canTransitionFiscalHomologationAttemptState,
} from '../shared/fiscalHomologationAttempt';
import { buildFiscalHomologationAttemptIdentity } from '../server/integrations/fiscalHomologationAttemptIdentity';

const ledgerSource = readFileSync(
  'server/integrations/fiscalHomologationAttemptLedger.ts',
  'utf8'
);
const contractSource = readFileSync(
  'shared/fiscalHomologationAttempt.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);

const frozenEvidence = {
  canonicalStoreId: 'store-1',
  orderId: 'order-1',
  sourceChannel: 'kyrub',
  environment: 'sandbox',
  policy: {
    policyId: 'homologation:store-1',
    version: 7,
    policyReference: 'contador/parecer-2026-09',
    effectiveFrom: '2026-09-20T00:00:00.000Z',
    operationScope: 'goods',
    documentFamily: 'nfce',
    operationalTrigger: 'payment_confirmed',
    environment: 'sandbox',
  },
  triggerEvidence: {
    trigger: 'payment_confirmed',
    satisfied: true,
    authority: 'canonical_payment_projection',
    payment: {
      projection: {
        expectedAmount: 29.5,
        authoritativelyPaidAmount: 29.5,
        outstandingAmount: 0,
        pendingPaymentCount: 0,
        canonicalPaymentCount: 1,
        state: 'paid',
      },
      consistency: 'canonical_ahead',
      ignoredLegacyMirrorCount: 0,
    },
  },
};

test('same frozen fiscal evidence always produces the same attempt id', () => {
  const first = buildFiscalHomologationAttemptIdentity(frozenEvidence);
  const second = buildFiscalHomologationAttemptIdentity({
    triggerEvidence: frozenEvidence.triggerEvidence,
    policy: frozenEvidence.policy,
    environment: frozenEvidence.environment,
    sourceChannel: frozenEvidence.sourceChannel,
    orderId: frozenEvidence.orderId,
    canonicalStoreId: frozenEvidence.canonicalStoreId,
  });

  assert.deepEqual(second, first);
  assert.match(first.evidenceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(first.attemptId, /^fiscal-attempt-[a-f0-9]{48}$/);
});

test('a different approved policy version creates a distinct attempt identity', () => {
  const first = buildFiscalHomologationAttemptIdentity(frozenEvidence);
  const changed = buildFiscalHomologationAttemptIdentity({
    ...frozenEvidence,
    policy: { ...frozenEvidence.policy, version: 8 },
  });

  assert.notEqual(changed.attemptId, first.attemptId);
  assert.notEqual(changed.evidenceFingerprint, first.evidenceFingerprint);
});

test('attempt state machine reserves ambiguity for reconciliation and keeps fiscal outcomes terminal', () => {
  assert.equal(canTransitionFiscalHomologationAttemptState('prepared', 'processing'), true);
  assert.equal(
    canTransitionFiscalHomologationAttemptState('processing', 'reconciliation_required'),
    true
  );
  assert.equal(
    canTransitionFiscalHomologationAttemptState('reconciliation_required', 'authorized'),
    true
  );
  assert.equal(canTransitionFiscalHomologationAttemptState('authorized', 'processing'), false);
  assert.equal(canTransitionFiscalHomologationAttemptState('rejected', 'processing'), false);
  assert.throws(
    () => assertFiscalHomologationAttemptStateTransition('authorized', 'processing'),
    /FISCAL_ATTEMPT_STATE_TRANSITION_INVALID/
  );
});

test('ledger rereads canonical authority and creates prepared attempts transactionally', () => {
  assert.match(ledgerSource, /hasStoreFiscalPermission\('owner', 'fiscal\.homologation\.emit'\)/);
  assert.match(ledgerSource, /canonicalStore\.ownerId/);
  assert.match(ledgerSource, /members\/\$\{requestedByUserId\}/);
  assert.match(ledgerSource, /loadCanonicalFiscalPreflight/);
  assert.match(ledgerSource, /preflight\.simulation\.preflightStatus !== 'ready_for_homologation'/);
  assert.match(ledgerSource, /transaction\.get\(attemptRef\)/);
  assert.match(ledgerSource, /transaction\.create\(attemptRef/);
  assert.match(ledgerSource, /reused: true/);
  assert.match(ledgerSource, /state: 'prepared'/);
});

test('prepared ledger cannot fabricate provider authorization evidence', () => {
  assert.match(ledgerSource, /providerAdapterId: null/);
  assert.match(ledgerSource, /providerAdapterVersion: null/);
  assert.match(ledgerSource, /externalRequestId: null/);
  assert.match(ledgerSource, /authorizationProtocol: null/);
  assert.match(ledgerSource, /accessKey: null/);
  assert.match(ledgerSource, /documentNumber: null/);
  assert.doesNotMatch(ledgerSource, /fetch\s*\(/);
  assert.doesNotMatch(ledgerSource, /axios|mercadoLivrePutJson|sendNinetyNineFood/);
});

test('fiscal attempt preparation is server-only in this cut and accepts no client evidence payload', () => {
  assert.doesNotMatch(routerSource, /fiscal-attempts/);
  assert.doesNotMatch(ledgerSource, /request\.body|request\.query|request\.params/);
  assert.doesNotMatch(ledgerSource, /policyId:\s*input\./);
  assert.doesNotMatch(ledgerSource, /documentFamily:\s*input\./);
  assert.doesNotMatch(ledgerSource, /operationalTrigger:\s*input\./);
  assert.doesNotMatch(ledgerSource, /resolvedRole:\s*input\./);
});

test('attempt contract keeps production emission authority out of scope', () => {
  assert.match(contractSource, /'fiscal\.homologation\.emit'/);
  assert.match(contractSource, /'reconciliation_required'/);
  assert.doesNotMatch(contractSource, /fiscal\.production\.emit/);
  assert.doesNotMatch(contractSource, /production_authorized/);
});
