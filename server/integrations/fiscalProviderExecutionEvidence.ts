import { createHash } from 'node:crypto';
import { adminDb } from '../firebaseAdmin.js';
import type { FiscalHomologationAttempt } from '../../shared/fiscalHomologationAttempt.js';
import type { FiscalExecutableDocumentSnapshot } from '../../shared/fiscalExecutableDocument.js';
import {
  validateFiscalGoodsLineTaxRule,
  type FiscalGoodsLineTaxRule,
  type FiscalTaxExecutionPolicy,
} from '../../shared/fiscalTaxExecutionPolicy.js';
import { buildCanonicalOrderFinancialProjection } from '../../shared/canonicalOrderFinancialProjection.js';
import type { PaymentMethod } from '../../src/utils/canonicalPayment.js';
import {
  normalizeBrazilFiscalTaxIdentifier,
  isValidBrazilFiscalTaxIdentifier,
} from '../../src/utils/brazilFiscalIdentifier.js';
import { classifyCompatiblePaymentRecord } from '../payments/paymentRecordCompatibility.js';
import { loadReadyFiscalExecutableDocumentSnapshot } from './fiscalExecutableDocumentSnapshotService.js';

const MAX_PAYMENT_RECORDS = 50;

const clean = (value: unknown, maxLength = 240): string =>
  typeof value === 'string' ? value.trim().slice(0, maxLength) : '';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const normalizedTaxId = (value: unknown): string =>
  normalizeBrazilFiscalTaxIdentifier(clean(value, 40));

const policyRevisionPath = (input: {
  canonicalStoreId: string;
  family: 'nfce';
  version: number;
}): string =>
  `stores/${input.canonicalStoreId}/fiscalTaxExecutionPolicies/${input.family}/revisions/v${String(input.version).padStart(6, '0')}`;

const parseBoundNfcePolicy = (
  value: unknown,
  expected: {
    canonicalStoreId: string;
    policyId: string;
    version: number;
  }
): FiscalTaxExecutionPolicy => {
  const raw = record(value);
  const operation = record(raw.operation);
  const goodsRaw = record(raw.goodsRules);
  const accountingReference = clean(raw.accountingReference, 180);
  const effectiveFrom = clean(raw.effectiveFrom, 64);
  if (
    raw.schemaVersion !== 1 ||
    clean(raw.policyId, 200) !== expected.policyId ||
    clean(raw.storeId, 160) !== expected.canonicalStoreId ||
    raw.version !== expected.version ||
    raw.status !== 'approved_for_homologation' ||
    !accountingReference ||
    !Number.isFinite(Date.parse(effectiveFrom)) ||
    raw.documentFamily !== 'nfce' ||
    raw.environment !== 'sandbox' ||
    raw.authority !== 'explicit_accounting_tax_policy_for_homologation' ||
    operation.kind !== 'goods_operation' ||
    !clean(operation.operationNature, 60) ||
    !['inbound', 'outbound'].includes(String(operation.documentDirection)) ||
    !['internal', 'interstate', 'foreign'].includes(String(operation.destinationLocation)) ||
    !['normal', 'complementary', 'adjustment', 'return', 'credit', 'debit'].includes(String(operation.purpose)) ||
    typeof operation.finalConsumer !== 'boolean' ||
    !['not_applicable', 'in_person', 'internet', 'telesales', 'home_delivery', 'offsite_in_person', 'other_non_in_person'].includes(String(operation.buyerPresence)) ||
    !['issuer', 'recipient', 'third_party', 'issuer_own', 'recipient_own', 'no_freight'].includes(String(operation.freightMode)) ||
    !['simples_nacional', 'simples_nacional_excess', 'regime_normal', 'mei'].includes(String(operation.issuerTaxRegime)) ||
    (operation.recipientIeIndicator !== null &&
      !['contributor', 'exempt', 'non_contributor'].includes(String(operation.recipientIeIndicator)))
  ) {
    throw new Error('FISCAL_EXECUTION_TAX_POLICY_REVISION_INVALID');
  }

  const goodsRules: Record<string, FiscalGoodsLineTaxRule> = {};
  try {
    for (const [productId, candidateValue] of Object.entries(goodsRaw)) {
      const candidate = record(candidateValue);
      goodsRules[productId] = validateFiscalGoodsLineTaxRule({
        ...(candidate as unknown as FiscalGoodsLineTaxRule),
        productId,
      });
    }
  } catch {
    throw new Error('FISCAL_EXECUTION_TAX_POLICY_REVISION_INVALID');
  }

  return {
    schemaVersion: 1,
    policyId: expected.policyId,
    storeId: expected.canonicalStoreId,
    version: expected.version,
    status: 'approved_for_homologation',
    accountingReference,
    effectiveFrom: new Date(effectiveFrom).toISOString(),
    documentFamily: 'nfce',
    operation: operation as unknown as FiscalTaxExecutionPolicy['operation'],
    goodsRules,
    serviceRules: {},
    environment: 'sandbox',
    authority: 'explicit_accounting_tax_policy_for_homologation',
  };
};

export interface FiscalExecutionPaymentEvidence {
  paymentId: string;
  amount: number;
  method: PaymentMethod;
  provider: string;
  providerPaymentId: string;
  paidAt: string;
}

export interface FiscalProviderExecutionEvidence {
  snapshot: FiscalExecutableDocumentSnapshot;
  taxPolicy: FiscalTaxExecutionPolicy;
  issuerTaxIdentifier: string;
  consumerTaxIdentifier: string | null;
  payments: FiscalExecutionPaymentEvidence[];
}

const loadRawIdentityEvidence = async (input: {
  tenantId: string;
  canonicalStoreId: string;
  attempt: FiscalHomologationAttempt;
  snapshot: FiscalExecutableDocumentSnapshot;
}): Promise<{ issuerTaxIdentifier: string; consumerTaxIdentifier: string | null }> => {
  const [tenantSnapshot, orderSnapshot] = await Promise.all([
    adminDb.doc(`tenants/${input.tenantId}`).get(),
    adminDb.doc(`stores/${input.canonicalStoreId}/orders/${input.attempt.orderId}`).get(),
  ]);
  if (!tenantSnapshot.exists || !orderSnapshot.exists) {
    throw new Error('FISCAL_EXECUTION_IDENTITY_SOURCE_NOT_FOUND');
  }
  const tenant = record(tenantSnapshot.data());
  const order = record(orderSnapshot.data());
  const operationalSettings = record(tenant.operationalSettings);
  const issuerProfile = record(operationalSettings.fiscalIssuerProfile);
  const integrations = record(operationalSettings.integrations);
  const sefaz = record(integrations.sefaz);
  const issuerTaxIdentifier = normalizedTaxId(
    Object.keys(issuerProfile).length > 0
      ? issuerProfile.taxIdentifier
      : sefaz.externalStoreId
  );
  if (
    !issuerTaxIdentifier ||
    !isValidBrazilFiscalTaxIdentifier(issuerTaxIdentifier) ||
    sha256(issuerTaxIdentifier) !== input.snapshot.identityFingerprints.issuerTaxIdentifierHash
  ) {
    throw new Error('FISCAL_EXECUTION_ISSUER_IDENTITY_STALE');
  }

  const consumer = record(order.fiscalConsumerIdentity);
  const consumerTaxIdentifier = normalizedTaxId(consumer.taxIdentifier) || null;
  const expectedConsumerHash = input.snapshot.identityFingerprints.consumerTaxIdentifierHash;
  if (
    (expectedConsumerHash === null && consumerTaxIdentifier !== null) ||
    (expectedConsumerHash !== null &&
      (!consumerTaxIdentifier ||
        !isValidBrazilFiscalTaxIdentifier(consumerTaxIdentifier) ||
        sha256(consumerTaxIdentifier) !== expectedConsumerHash))
  ) {
    throw new Error('FISCAL_EXECUTION_CONSUMER_IDENTITY_STALE');
  }

  return { issuerTaxIdentifier, consumerTaxIdentifier };
};

const loadPaymentEvidence = async (input: {
  canonicalStoreId: string;
  attempt: FiscalHomologationAttempt;
  documentTotal: number;
}): Promise<FiscalExecutionPaymentEvidence[]> => {
  const querySnapshot = await adminDb
    .collection(`stores/${input.canonicalStoreId}/payments`)
    .where('orderId', '==', input.attempt.orderId)
    .limit(MAX_PAYMENT_RECORDS + 1)
    .get();
  if (querySnapshot.size > MAX_PAYMENT_RECORDS) {
    throw new Error('FISCAL_EXECUTION_PAYMENT_EVIDENCE_CAPPED');
  }

  const canonical = [] as Array<ReturnType<typeof classifyCompatiblePaymentRecord> extends infer T
    ? T extends { kind: 'canonical'; payment: infer P } ? P : never
    : never>;
  let legacyMirrorCount = 0;
  for (const document of querySnapshot.docs) {
    const compatible = classifyCompatiblePaymentRecord(
      document.data(),
      input.canonicalStoreId
    );
    if (compatible.kind === 'legacy_table_payment_mirror') {
      legacyMirrorCount += 1;
      continue;
    }
    if (compatible.payment.orderId !== input.attempt.orderId) {
      throw new Error('FISCAL_EXECUTION_PAYMENT_EVIDENCE_STALE');
    }
    canonical.push(compatible.payment);
  }
  if (legacyMirrorCount > 0) {
    throw new Error('FISCAL_EXECUTION_LEGACY_PAYMENT_MIRROR_PRESENT');
  }

  const projection = buildCanonicalOrderFinancialProjection({
    expectedAmount: input.documentTotal,
    payments: canonical.map(payment => ({
      amount: payment.amount,
      status: payment.status,
    })),
  });
  if (
    projection.state !== 'paid' ||
    projection.pendingPaymentCount !== 0 ||
    Math.abs(projection.authoritativelyPaidAmount - input.documentTotal) > 0.009
  ) {
    throw new Error('FISCAL_EXECUTION_PAYMENT_TOTAL_MISMATCH');
  }

  const payments: FiscalExecutionPaymentEvidence[] = [];
  for (const payment of canonical) {
    if (
      payment.status === 'refund_requested' ||
      payment.status === 'refund_processing' ||
      payment.status === 'refunded' ||
      payment.status === 'refund_failed' ||
      payment.status === 'charged_back' ||
      payment.status === 'chargeback_reversed'
    ) {
      throw new Error('FISCAL_EXECUTION_PAYMENT_STATE_NOT_ELIGIBLE');
    }
    if (payment.status !== 'paid') continue;
    payments.push({
      paymentId: payment.id,
      amount: payment.amount,
      method: payment.method,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      paidAt: payment.paidAt,
    });
  }

  const paidTotal = Number(
    payments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)
  );
  if (payments.length === 0 || Math.abs(paidTotal - input.documentTotal) > 0.009) {
    throw new Error('FISCAL_EXECUTION_PAYMENT_TOTAL_MISMATCH');
  }
  return payments.sort((a, b) => a.paymentId.localeCompare(b.paymentId));
};

export const loadFiscalProviderExecutionEvidence = async (input: {
  tenantId: string;
  canonicalStoreId: string;
  attempt: FiscalHomologationAttempt;
}): Promise<FiscalProviderExecutionEvidence> => {
  if (
    input.attempt.state !== 'prepared' ||
    input.attempt.policy.documentFamily !== 'nfce' ||
    input.attempt.environment !== 'sandbox'
  ) {
    throw new Error('FISCAL_EXECUTION_ATTEMPT_NOT_ELIGIBLE');
  }
  const snapshot = await loadReadyFiscalExecutableDocumentSnapshot({
    canonicalStoreId: input.canonicalStoreId,
    attempt: input.attempt,
  });
  if (
    snapshot.documentFamily !== 'nfce' ||
    snapshot.environment !== 'sandbox' ||
    snapshot.taxExecutionPolicy.status !== 'bound' ||
    !snapshot.taxExecutionPolicy.policyId ||
    typeof snapshot.taxExecutionPolicy.version !== 'number'
  ) {
    throw new Error('FISCAL_EXECUTABLE_DOCUMENT_NOT_READY');
  }
  const policySnapshot = await adminDb.doc(policyRevisionPath({
    canonicalStoreId: input.canonicalStoreId,
    family: 'nfce',
    version: snapshot.taxExecutionPolicy.version,
  })).get();
  if (!policySnapshot.exists) {
    throw new Error('FISCAL_EXECUTION_TAX_POLICY_REVISION_NOT_FOUND');
  }
  const taxPolicy = parseBoundNfcePolicy(policySnapshot.data(), {
    canonicalStoreId: input.canonicalStoreId,
    policyId: snapshot.taxExecutionPolicy.policyId,
    version: snapshot.taxExecutionPolicy.version,
  });
  const identities = await loadRawIdentityEvidence({
    tenantId: input.tenantId,
    canonicalStoreId: input.canonicalStoreId,
    attempt: input.attempt,
    snapshot,
  });
  const payments = await loadPaymentEvidence({
    canonicalStoreId: input.canonicalStoreId,
    attempt: input.attempt,
    documentTotal: snapshot.documentTotal,
  });

  return {
    snapshot,
    taxPolicy,
    ...identities,
    payments,
  };
};