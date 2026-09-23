import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isFiscalTaxExecutionPolicyEffective,
  validateFiscalGoodsLineTaxRule,
  validateFiscalServiceLineTaxRule,
  type FiscalTaxExecutionPolicy,
} from '../shared/fiscalTaxExecutionPolicy';

const registrySource = readFileSync(
  'server/integrations/fiscalTaxExecutionPolicyRegistry.ts',
  'utf8'
);
const bindingSource = readFileSync(
  'server/integrations/fiscalExecutableDocumentTaxBindingService.ts',
  'utf8'
);

test('goods tax decisions must be explicit and include reform classification codes', () => {
  const rule = validateFiscalGoodsLineTaxRule({
    productId: 'product-1',
    cfop: '5102',
    icmsSituation: '102',
    pisSituation: '49',
    cofinsSituation: '49',
    ibsCbsSituation: '000',
    ibsCbsClassification: '000001',
    explicitTaxFacts: { accountant_verified: true },
  });
  assert.equal(rule.cfop, '5102');
  assert.equal(rule.ibsCbsSituation, '000');
  assert.equal(rule.ibsCbsClassification, '000001');

  assert.throws(
    () => validateFiscalGoodsLineTaxRule({ ...rule, cfop: '' }),
    /FISCAL_TAX_RULE_GOODS_INCOMPLETE/
  );
  assert.throws(
    () => validateFiscalGoodsLineTaxRule({ ...rule, ibsCbsClassification: '' }),
    /FISCAL_TAX_RULE_GOODS_INCOMPLETE/
  );
});

test('service tax rule never invents municipal classification or ISS rate', () => {
  const rule = validateFiscalServiceLineTaxRule({
    productId: 'service-1',
    serviceListCode: '01.01',
    municipalServiceCode: '1001',
    issRate: null,
    issWithheld: null,
    explicitTaxFacts: {},
  });
  assert.equal(rule.issRate, null);
  assert.equal(rule.issWithheld, null);
  assert.throws(
    () => validateFiscalServiceLineTaxRule({ ...rule, serviceListCode: '', municipalServiceCode: '' }),
    /FISCAL_TAX_RULE_SERVICE_INCOMPLETE/
  );
});

test('approved tax policy is only effective from its explicit effective date', () => {
  const policy: FiscalTaxExecutionPolicy = {
    schemaVersion: 1,
    policyId: 'tax-execution:store-1:nfce',
    storeId: 'store-1',
    version: 3,
    status: 'approved_for_homologation',
    accountingReference: 'contador-2026-09',
    effectiveFrom: '2026-09-24T00:00:00.000Z',
    documentFamily: 'nfce',
    operation: {
      kind: 'goods_operation',
      operationNature: 'VENDA AO CONSUMIDOR',
      documentDirection: 'outbound',
      destinationLocation: 'internal',
      purpose: 'normal',
      finalConsumer: true,
      buyerPresence: 'in_person',
      freightMode: 'no_freight',
      issuerTaxRegime: 'simples_nacional',
      recipientIeIndicator: 'non_contributor',
    },
    goodsRules: {},
    serviceRules: {},
    environment: 'sandbox',
    authority: 'explicit_accounting_tax_policy_for_homologation',
  };
  assert.equal(
    isFiscalTaxExecutionPolicyEffective(policy, new Date('2026-09-23T23:59:59.000Z')),
    false
  );
  assert.equal(
    isFiscalTaxExecutionPolicyEffective(policy, new Date('2026-09-24T00:00:00.000Z')),
    true
  );
});

test('registry creates immutable revisions and remains server-authoritative', () => {
  assert.match(registrySource, /fiscalTaxExecutionPolicies\/\$\{family\}/);
  assert.match(registrySource, /revisions\/v\$\{String\(version\)\.padStart\(6, '0'\)\}/);
  assert.match(registrySource, /transaction\.create\(adminDb\.doc\(revisionPath/);
  assert.match(registrySource, /resolveFiscalHomologationOwnerAuthority/);
  assert.match(registrySource, /explicit_accounting_tax_policy_for_homologation/);
  assert.doesNotMatch(registrySource, /defaultCfop|defaultCst|inferTax|inferCfop/i);
});

test('binding requires an explicit rule for every frozen line and produces a new ready snapshot', () => {
  assert.match(bindingSource, /policy\.goodsRules\[line\.productId\]/);
  assert.match(bindingSource, /FISCAL_TAX_EXECUTION_PRODUCT_RULE_REQUIRED/);
  assert.match(bindingSource, /policy\.serviceRules\[line\.productId\]/);
  assert.match(bindingSource, /FISCAL_TAX_EXECUTION_SERVICE_RULE_REQUIRED/);
  assert.match(bindingSource, /sourceSnapshotFingerprint: source\.evidenceFingerprint/);
  assert.match(bindingSource, /policyId: policy\.policyId/);
  assert.match(bindingSource, /version: policy\.version/);
  assert.match(bindingSource, /status: 'ready'/);
  assert.match(bindingSource, /transaction\.create\(readyRef/);
  assert.doesNotMatch(bindingSource, /fetch\s*\(|adapter\.submit|focusnfe|sefaz/i);
});
