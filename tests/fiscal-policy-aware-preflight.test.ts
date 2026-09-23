import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { simulateFiscalHomologationPreflight } from '../shared/fiscalHomologationPreflightSimulation';

const serviceSource = readFileSync(
  'server/integrations/fiscalPreflightReadService.ts',
  'utf8'
);
const uiSource = readFileSync(
  'src/components/store/FiscalPreflightWorkspace.tsx',
  'utf8'
);

const approvedPolicy = {
  status: 'approved' as const,
  policyId: 'homologation:store-1',
  version: 7,
  policyReference: 'contador/parecer-2026-09',
  effectiveFrom: '2026-09-20T00:00:00.000Z',
  operationScope: 'goods' as const,
  documentFamily: 'nfce' as const,
  operationalTrigger: 'payment_confirmed' as const,
  environment: 'sandbox' as const,
  authority: 'canonical_homologation_policy_registry' as const,
  sourcePath: 'stores/store-1/fiscalPolicies/homologation',
};

const paidTrigger = {
  trigger: 'payment_confirmed' as const,
  satisfied: true,
  authority: 'canonical_payment_projection' as const,
  payment: {
    projection: {
      expectedAmount: 29.5,
      authoritativelyPaidAmount: 29.5,
      outstandingAmount: 0,
      pendingPaymentCount: 0,
      canonicalPaymentCount: 1,
      state: 'paid' as const,
    },
    consistency: 'canonical_ahead' as const,
    ignoredLegacyMirrorCount: 0,
  },
};

test('approved applicable policy plus canonical paid evidence becomes ready only for homologation', () => {
  const result = simulateFiscalHomologationPreflight({
    storeId: 'store-1',
    orderId: 'order-1',
    sourceChannel: 'kyrub',
    simulatedAt: '2026-09-23T09:00:00.000Z',
    orderScope: 'goods',
    issuerIdentity: {
      status: 'ready',
      identifierKind: 'cnpj',
      environment: 'sandbox',
    },
    policy: approvedPolicy,
    triggerEvidence: paidTrigger,
    items: [{ productId: 'product-1', kind: 'goods', fiscalProfileReady: true }],
  });

  assert.equal(result.schemaVersion, 3);
  assert.equal(result.preflightStatus, 'ready_for_homologation');
  assert.deepEqual(result.blockingReasons, []);
  assert.equal(result.execution.documentFamily, 'nfce');
  assert.equal(result.execution.fiscalTrigger, 'payment_confirmed');
  assert.equal(result.execution.emissionAuthority, 'none_homologation_only');
  assert.equal(result.execution.providerCallAllowed, false);
  assert.equal(result.execution.sefazCallAllowed, false);
  assert.equal(result.artifact.authoritativeDocument, false);
});

test('missing policy fails closed without selecting a family or trigger', () => {
  const result = simulateFiscalHomologationPreflight({
    storeId: 'store-1',
    orderId: 'order-2',
    sourceChannel: 'kyrub',
    simulatedAt: '2026-09-23T09:00:00.000Z',
    orderScope: 'goods',
    issuerIdentity: {
      status: 'ready',
      identifierKind: 'cnpj',
      environment: 'sandbox',
    },
    policy: {
      ...approvedPolicy,
      status: 'missing',
      policyId: null,
      version: null,
      policyReference: null,
      effectiveFrom: null,
      operationScope: null,
      documentFamily: null,
      operationalTrigger: null,
    },
    triggerEvidence: {
      trigger: null,
      satisfied: false,
      authority: 'homologation_policy_required',
      payment: null,
    },
    items: [{ productId: 'product-1', kind: 'goods', fiscalProfileReady: true }],
  });

  assert.equal(result.preflightStatus, 'blocked');
  assert.deepEqual(result.blockingReasons, ['homologation_policy_required']);
  assert.equal(result.execution.documentFamily, null);
  assert.equal(result.execution.fiscalTrigger, null);
});

test('future or scope-mismatched policy is auditable but not executable even in homologation', () => {
  const result = simulateFiscalHomologationPreflight({
    storeId: 'store-1',
    orderId: 'order-3',
    sourceChannel: 'kyrub',
    simulatedAt: '2026-09-23T09:00:00.000Z',
    orderScope: 'service',
    issuerIdentity: {
      status: 'ready',
      identifierKind: 'cnpj',
      environment: 'sandbox',
    },
    policy: {
      ...approvedPolicy,
      effectiveFrom: '2026-10-01T00:00:00.000Z',
    },
    triggerEvidence: paidTrigger,
    items: [{ productId: 'service-1', kind: 'service', fiscalProfileReady: true }],
  });

  assert.deepEqual(result.blockingReasons, [
    'homologation_policy_not_effective',
    'homologation_policy_scope_mismatch',
  ]);
  assert.equal(result.execution.documentFamily, null);
  assert.equal(result.execution.fiscalTrigger, null);
});

test('unimplemented fulfillment and service triggers fail closed', () => {
  const result = simulateFiscalHomologationPreflight({
    storeId: 'store-1',
    orderId: 'order-4',
    sourceChannel: '99food',
    simulatedAt: '2026-09-23T09:00:00.000Z',
    orderScope: 'goods',
    issuerIdentity: {
      status: 'ready',
      identifierKind: 'cnpj',
      environment: 'sandbox',
    },
    policy: {
      ...approvedPolicy,
      operationalTrigger: 'fulfillment_confirmed',
    },
    triggerEvidence: {
      trigger: 'fulfillment_confirmed',
      satisfied: false,
      authority: 'not_implemented_fail_closed',
      payment: null,
    },
    items: [{ productId: 'product-1', kind: 'goods', fiscalProfileReady: true }],
  });

  assert.deepEqual(result.blockingReasons, ['operational_trigger_not_satisfied']);
  assert.equal(result.preflightStatus, 'blocked');
  assert.equal(result.execution.providerCallAllowed, false);
});

test('server preflight uses canonical policy and payment evidence instead of order paymentStatus authority', () => {
  assert.match(serviceSource, /fiscalPolicies\/homologation/);
  assert.match(serviceSource, /classifyCompatiblePaymentRecord/);
  assert.match(serviceSource, /buildCanonicalOrderFinancialProjection/);
  assert.match(serviceSource, /canonical_payment_projection/);
  assert.match(serviceSource, /payment_history_limit_reached/);
  assert.doesNotMatch(
    serviceSource,
    /const\s+commerciallyConfirmed\s*=\s*order\.paymentStatus\s*===\s*['"]paid['"]/
  );
  assert.doesNotMatch(serviceSource, /fiscalAccountingDecision/);
  assert.doesNotMatch(serviceSource, /fetch\s*\(/);
});

test('policy-aware preflight UI exposes exact policy evidence but no emission CTA', () => {
  assert.match(uiSource, /schemaVersion: 3/);
  assert.match(uiSource, /Política de homologação/);
  assert.match(uiSource, /policy\.version/);
  assert.match(uiSource, /Evidência autoritativa satisfeita/);
  assert.match(uiSource, /Sem autoridade de emissão/);
  assert.doesNotMatch(uiSource, />\s*Emitir(?:\s|<)/i);
});
