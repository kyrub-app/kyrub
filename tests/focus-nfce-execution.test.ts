import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { FiscalProviderExecutionEvidence } from '../server/integrations/fiscalProviderExecutionEvidence';
import {
  buildFocusNfcePayload,
  focusNfcePaymentCode,
} from '../server/integrations/focusNfcePayloadBuilder';
import { createRuntimeFiscalProviderAdapterRegistry } from '../server/integrations/fiscalProviderAdapter';

const evidence = (): FiscalProviderExecutionEvidence => ({
  snapshot: {
    schemaVersion: 1,
    snapshotId: 'fiscal-doc-snapshot-test',
    evidenceFingerprint: 'a'.repeat(64),
    canonicalStoreId: 'store-test',
    attemptId: `fiscal-attempt-${'b'.repeat(48)}`,
    orderId: 'order-test',
    documentFamily: 'nfce',
    operationScope: 'goods',
    environment: 'sandbox',
    lines: [
      {
        lineId: 'line-1',
        productId: 'product-1',
        productName: 'Produto teste',
        kind: 'goods',
        quantity: 2,
        unitPrice: 10,
        discountAmount: 2,
        lineTotal: 18,
        fiscalProfile: {
          kind: 'goods',
          fiscalDescription: 'Produto teste',
          ncm: '12345678',
          cest: '',
          gtin: '',
          noGtin: true,
          commercialUnit: 'UN',
          taxUnit: 'UN',
          conversionFactor: 1,
          origin: '0',
        },
      },
    ],
    subtotal: 20,
    discountTotal: 2,
    documentTotal: 18,
    identityFingerprints: {
      issuerTaxIdentifierHash: 'c'.repeat(64),
      consumerTaxIdentifierHash: null,
    },
    taxExecutionPolicy: {
      status: 'bound',
      policyId: 'tax-execution:store-test:nfce',
      version: 1,
    },
    status: 'ready',
    createdAt: '2026-09-23T12:00:00.000Z',
    authority: 'kyrub_canonical_fiscal_document_snapshot',
  },
  taxPolicy: {
    schemaVersion: 1,
    policyId: 'tax-execution:store-test:nfce',
    storeId: 'store-test',
    version: 1,
    status: 'approved_for_homologation',
    accountingReference: 'contador-2026-09',
    effectiveFrom: '2026-09-01T00:00:00.000Z',
    documentFamily: 'nfce',
    operation: {
      kind: 'goods_operation',
      operationNature: 'Venda de mercadoria',
      documentDirection: 'outbound',
      destinationLocation: 'internal',
      purpose: 'normal',
      finalConsumer: true,
      buyerPresence: 'in_person',
      freightMode: 'no_freight',
      issuerTaxRegime: 'simples_nacional',
      recipientIeIndicator: null,
    },
    goodsRules: {
      'product-1': {
        productId: 'product-1',
        cfop: '5102',
        icmsSituation: '102',
        pisSituation: '49',
        cofinsSituation: '49',
        ibsCbsSituation: '000',
        ibsCbsClassification: '000001',
        explicitTaxFacts: {
          icms_aliquota: 0,
          segredo_nao_permitido: 'nao-propagar',
        },
      },
    },
    serviceRules: {},
    environment: 'sandbox',
    authority: 'explicit_accounting_tax_policy_for_homologation',
  },
  issuerTaxIdentifier: '11222333000181',
  consumerTaxIdentifier: null,
  payments: [
    {
      paymentId: 'payment-1',
      amount: 18,
      method: 'pix',
      provider: 'store-pix',
      providerPaymentId: 'provider-payment-1',
      paidAt: '2026-09-23T12:00:00.000Z',
    },
  ],
});

test('NFC-e payment mapping uses only authoritative provider facts', () => {
  assert.equal(focusNfcePaymentCode({ method: 'cash', provider: 'manual' }), '01');
  assert.equal(focusNfcePaymentCode({ method: 'pix', provider: 'store-pix' }), '20');
  assert.equal(focusNfcePaymentCode({ method: 'pix', provider: 'mercado-pago' }), '17');
  assert.throws(
    () => focusNfcePaymentCode({ method: 'card', provider: 'stone' }),
    /FOCUS_NFCE_PAYMENT_FORM_UNSUPPORTED/
  );
  assert.throws(
    () => focusNfcePaymentCode({ method: 'pix', provider: 'unknown-pix' }),
    /FOCUS_NFCE_PAYMENT_FORM_UNSUPPORTED/
  );
});

test('Focus NFC-e payload is built from explicit frozen evidence only', () => {
  const result = buildFocusNfcePayload({
    evidence: evidence(),
    emissionAt: new Date('2026-09-23T12:30:00.000Z'),
  });
  const payload = result.payload as Record<string, unknown>;
  const items = payload.items as Array<Record<string, unknown>>;
  const payments = payload.formas_pagamento as Array<Record<string, unknown>>;

  assert.equal(payload.cnpj_emitente, '11222333000181');
  assert.equal(payload.data_emissao, '2026-09-23T12:30:00.000Z');
  assert.equal(payload.valor_total, 18);
  assert.equal(payload.cpf_destinatario, undefined);
  assert.equal(payload.cnpj_destinatario, undefined);
  assert.equal(payload.indicador_inscricao_estadual_destinatario, undefined);
  assert.equal(items[0].cfop, '5102');
  assert.equal(items[0].ibs_cbs_situacao_tributaria, '000');
  assert.equal(items[0].ibs_cbs_classificacao_tributaria, '000001');
  assert.equal(items[0].icms_aliquota, 0);
  assert.equal(items[0].segredo_nao_permitido, undefined);
  assert.equal(payments[0].forma_pagamento, '20');
  assert.match(result.payloadFingerprint, /^[a-f0-9]{64}$/);
});

test('NFC-e payload fails closed for unsupported issuer, payment or unit conversion', () => {
  const cpfIssuer = evidence();
  cpfIssuer.issuerTaxIdentifier = '52998224725';
  assert.throws(
    () => buildFocusNfcePayload({ evidence: cpfIssuer, emissionAt: new Date() }),
    /FOCUS_NFCE_CNPJ_ISSUER_REQUIRED/
  );

  const cardPayment = evidence();
  cardPayment.payments[0].method = 'card';
  assert.throws(
    () => buildFocusNfcePayload({ evidence: cardPayment, emissionAt: new Date() }),
    /FOCUS_NFCE_PAYMENT_FORM_UNSUPPORTED/
  );

  const convertedUnit = evidence();
  const goods = convertedUnit.snapshot.lines[0].fiscalProfile;
  if (goods.kind !== 'goods') throw new Error('test fixture invalid');
  goods.taxUnit = 'CX';
  goods.conversionFactor = 12;
  assert.throws(
    () => buildFocusNfcePayload({ evidence: convertedUnit, emissionAt: new Date() }),
    /FOCUS_NFCE_TAX_UNIT_CONVERSION_UNSUPPORTED/
  );
});

test('runtime registry exposes Focus v1 only for NFC-e sandbox', () => {
  const adapter = createRuntimeFiscalProviderAdapterRegistry().get('focus-nfe', '1');
  assert.deepEqual(adapter.supportedDocumentFamilies, ['nfce']);
  assert.deepEqual(adapter.supportedEnvironments, ['sandbox']);
});

test('executor verifies fiscal evidence before provider config and freezes ref/fingerprint before POST', () => {
  const source = readFileSync('server/integrations/fiscalProviderExecutionService.ts', 'utf8');
  const evidenceIndex = source.indexOf('loadFiscalProviderExecutionEvidence({');
  const protectedContextIndex = source.indexOf('loadProtectedAdapterContext({', evidenceIndex);
  const claimIndex = source.indexOf("providerStatus: 'submission_claimed'", protectedContextIndex);
  const submitIndex = source.indexOf('context.adapter.submit({', claimIndex);

  assert.ok(evidenceIndex >= 0);
  assert.ok(protectedContextIndex > evidenceIndex);
  assert.ok(claimIndex > protectedContextIndex);
  assert.ok(submitIndex > claimIndex);
  assert.match(source.slice(claimIndex - 700, submitIndex), /providerPayloadFingerprint/);
  assert.match(source.slice(claimIndex - 700, submitIndex), /externalRequestId/);
});

test('reconciliation is GET-only and canonical payment evidence rejects legacy ambiguity', () => {
  const executor = readFileSync('server/integrations/fiscalProviderExecutionService.ts', 'utf8');
  const evidenceSource = readFileSync('server/integrations/fiscalProviderExecutionEvidence.ts', 'utf8');
  const reconcile = executor.slice(executor.indexOf('export const reconcileFiscalHomologationAttempt'));

  assert.match(reconcile, /context\.adapter\.getStatus\(/);
  assert.doesNotMatch(reconcile, /context\.adapter\.submit\(/);
  assert.match(evidenceSource, /\.limit\(MAX_PAYMENT_RECORDS \+ 1\)/);
  assert.match(evidenceSource, /FISCAL_EXECUTION_LEGACY_PAYMENT_MIRROR_PRESENT/);
  assert.match(evidenceSource, /identityFingerprints\.issuerTaxIdentifierHash/);
  assert.match(evidenceSource, /identityFingerprints\.consumerTaxIdentifierHash/);
  assert.match(evidenceSource, /\/revisions\/v\$\{String\(input\.version\)/);
});
