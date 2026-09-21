import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createEmptyProductFiscalProfile,
  normalizeProductFiscalProfile,
  parseProductFiscalProfiles,
} from '../src/utils/productFiscal';
import { simulateFiscalPreflight } from '../shared/fiscalSimulation';

const editorSource = readFileSync(
  'src/components/store/ProductEditorModal.tsx',
  'utf8'
);
const fieldsSource = readFileSync(
  'src/components/store/ProductFiscalFieldsBridge.tsx',
  'utf8'
);
const rulesSource = readFileSync(
  'firestore.product-inventory.fragment.rules',
  'utf8'
);
const fiscalSimulationSource = readFileSync(
  'shared/fiscalSimulation.ts',
  'utf8'
);
const fiscalPreflightServiceSource = readFileSync(
  'server/integrations/fiscalPreflightReadService.ts',
  'utf8'
);
const storeConnectionRouterSource = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);

test('disabled fiscal preparation keeps the item free of fiscal requirements', () => {
  const draft = createEmptyProductFiscalProfile('goods');
  assert.equal(normalizeProductFiscalProfile(draft, 'goods'), null);
});

test('goods fiscal profile validates NCM, optional CEST and GTIN semantics', () => {
  const draft = {
    ...createEmptyProductFiscalProfile('goods'),
    enabled: true,
    fiscalDescription: 'Refrigerante lata 350 ml',
    ncm: '22021000',
    cest: '0300700',
    noGtin: false,
    gtin: '7894900011517',
  };

  const normalized = normalizeProductFiscalProfile(draft, 'goods');
  assert.ok(normalized);
  assert.equal(normalized.ncm, '22021000');
  assert.equal(normalized.cest, '0300700');
  assert.equal(normalized.gtin, '7894900011517');
  assert.equal(normalized.kind, 'goods');
});

test('goods profile rejects incomplete NCM and invalid GTIN', () => {
  const draft = {
    ...createEmptyProductFiscalProfile('goods'),
    enabled: true,
    fiscalDescription: 'Produto de teste',
    ncm: '1234',
  };
  assert.throws(
    () => normalizeProductFiscalProfile(draft, 'goods'),
    /NCM deve conter exatamente 8 dígitos/
  );

  assert.throws(
    () =>
      normalizeProductFiscalProfile(
        {
          ...draft,
          ncm: '22021000',
          noGtin: false,
          gtin: '12345678',
        },
        'goods'
      ),
    /GTIN\/EAN válido/
  );
});

test('service profile uses service classification instead of NCM', () => {
  const normalized = normalizeProductFiscalProfile(
    {
      ...createEmptyProductFiscalProfile('service'),
      enabled: true,
      fiscalDescription: 'Manutenção preventiva',
      serviceListCode: '14.01',
      ncm: '99999999',
    },
    'service'
  );

  assert.ok(normalized);
  assert.equal(normalized.kind, 'service');
  assert.equal(normalized.serviceListCode, '14.01');
  assert.equal(normalized.ncm, '');
});

test('stored fiscal profiles discard invalid ids and disabled entries', () => {
  const parsed = parseProductFiscalProfiles({
    'product-1': {
      ...createEmptyProductFiscalProfile('goods'),
      enabled: true,
      fiscalDescription: 'Produto',
      ncm: '22021000',
    },
    'invalid/id': {
      ...createEmptyProductFiscalProfile('goods'),
      enabled: true,
    },
    disabled: createEmptyProductFiscalProfile('goods'),
  });

  assert.deepEqual(Object.keys(parsed), ['product-1']);
});

test('product editor mounts private fiscal fields and rolls them back on save failure', () => {
  assert.match(editorSource, /ProductFiscalFieldsBridge/);
  assert.match(editorSource, /normalizeProductFiscalProfile/);
  assert.match(editorSource, /persistProductFiscalProfile/);
  assert.match(editorSource, /previousFiscalProfile/);
  assert.match(editorSource, /Não foi possível reverter os dados fiscais/);
});

test('fiscal interface separates goods and services without exposing tax rates', () => {
  assert.match(fieldsSource, /Dados fiscais e nota/);
  assert.match(fieldsSource, /Preparar este item para emissão fiscal/);
  assert.match(fieldsSource, /NCM · 8 dígitos/);
  assert.match(fieldsSource, /CEST · quando aplicável/);
  assert.match(fieldsSource, /GTIN\/EAN/);
  assert.match(fieldsSource, /Origem da mercadoria/);
  assert.match(fieldsSource, /Item da lista de serviços/);
  assert.match(fieldsSource, /Código municipal do serviço/);
  assert.doesNotMatch(fieldsSource, /Alíquota de ICMS/);
  assert.doesNotMatch(fieldsSource, /CFOP padrão/);
});

test('private inventory rules admit only an owner fiscal map', () => {
  assert.match(rulesSource, /productFiscalProfiles/);
  assert.match(rulesSource, /data\.productFiscalProfiles is map/);
  assert.match(rulesSource, /request\.auth\.uid == userId/);
  assert.match(rulesSource, /productFiscalProfiles\.size\(\) <= 200/);
});

test('fiscal preflight never turns payment confirmation into emission authority', () => {
  const simulation = simulateFiscalPreflight({
    storeId: 'store-1',
    orderId: 'order-123',
    sourceChannel: 'kyrub',
    commerciallyConfirmed: true,
    issuerIdentity: {
      status: 'ready',
      identifierKind: 'cpf',
      environment: 'sandbox',
    },
    items: [{ productId: 'product-1', kind: 'goods', fiscalProfileReady: true }],
    simulatedAt: '2026-09-21T18:00:00-03:00',
  });

  assert.equal(simulation.schemaVersion, 2);
  assert.equal(simulation.mode, 'simulation_only');
  assert.equal(simulation.simulationStatus, 'blocked');
  assert.equal(simulation.candidate.commercialEvidence, 'confirmed');
  assert.equal(simulation.candidate.status, 'accounting_decision_required');
  assert.deepEqual(simulation.blockingReasons, ['accounting_decision_required']);
  assert.deepEqual(simulation.requiredInputs, ['accounting_decision']);
  assert.equal(simulation.execution.fiscalTrigger, null);
  assert.equal(simulation.execution.documentFamily, null);
  assert.equal(simulation.execution.emissionAuthority, 'none_until_accounting_policy');
  assert.equal(simulation.execution.providerCallAllowed, false);
  assert.equal(simulation.execution.sefazCallAllowed, false);
  assert.equal(simulation.artifact.authoritativeDocument, false);
});

test('fiscal issuer identity is an explicit preflight gate', () => {
  const simulation = simulateFiscalPreflight({
    storeId: 'store-1',
    orderId: 'order-without-issuer',
    sourceChannel: 'kyrub',
    commerciallyConfirmed: true,
    items: [{ productId: 'product-1', kind: 'goods', fiscalProfileReady: true }],
    simulatedAt: '2026-09-21T18:05:00-03:00',
  });

  assert.equal(simulation.issuerIdentity.status, 'required');
  assert.deepEqual(simulation.blockingReasons, [
    'accounting_decision_required',
    'fiscal_issuer_identity_required',
  ]);
  assert.deepEqual(simulation.requiredInputs, [
    'accounting_decision',
    'fiscal_issuer_identity',
  ]);
});

test('recorded accounting reference advances only to executable policy resolution', () => {
  const simulation = simulateFiscalPreflight({
    storeId: 'store-1',
    orderId: 'order-accounting-reference',
    sourceChannel: '99food',
    commerciallyConfirmed: true,
    issuerIdentity: {
      status: 'ready',
      identifierKind: 'cnpj',
      environment: 'sandbox',
    },
    accountingDecision: {
      status: 'recorded',
      policyReference: ' contador/parecer-fiscal-2026-09 ',
      recordedAt: '2026-09-21T14:30:00-03:00',
    },
    items: [{ productId: 'product-1', kind: 'goods', fiscalProfileReady: true }],
    simulatedAt: '2026-09-21T18:10:00-03:00',
  });

  assert.equal(simulation.candidate.status, 'accounting_policy_resolution_required');
  assert.deepEqual(simulation.blockingReasons, ['accounting_policy_resolution_required']);
  assert.deepEqual(simulation.requiredInputs, ['executable_accounting_policy']);
  assert.equal(simulation.execution.providerCallAllowed, false);
  assert.equal(simulation.execution.sefazCallAllowed, false);
});

test('simulation accumulates issuer, product and commercial gaps without selecting a document', () => {
  const simulation = simulateFiscalPreflight({
    storeId: 'store-1',
    orderId: 'order-incomplete',
    sourceChannel: 'other',
    commerciallyConfirmed: false,
    items: [{
      productId: 'product-missing-fiscal-profile',
      kind: 'service',
      fiscalProfileReady: false,
    }],
    simulatedAt: '2026-09-21T18:15:00-03:00',
  });

  assert.deepEqual(simulation.blockingReasons, [
    'accounting_decision_required',
    'fiscal_issuer_identity_required',
    'product_fiscal_preparation_incomplete',
    'commercial_confirmation_required',
  ]);
  assert.equal(simulation.candidate.documentFamily, null);
  assert.equal(simulation.candidate.trigger, null);
  assert.deepEqual(simulation.candidate.missingProductIds, ['product-missing-fiscal-profile']);
});

test('simulation artifact cannot masquerade as an authorized fiscal document', () => {
  const simulation = simulateFiscalPreflight({
    storeId: 'store-1',
    orderId: 'order-no-fake-document',
    sourceChannel: 'kyrub',
    commerciallyConfirmed: true,
    issuerIdentity: {
      status: 'ready',
      identifierKind: 'cpf',
      environment: 'sandbox',
    },
    items: [],
    simulatedAt: '2026-09-21T18:20:00-03:00',
  });
  const serialized = JSON.stringify(simulation);

  assert.equal(simulation.artifact.kind, 'fiscal_preflight_simulation');
  assert.equal(simulation.artifact.authoritativeDocument, false);
  assert.doesNotMatch(
    serialized,
    /accessKey|chaveDeAcesso|authorizationProtocol|documentNumber|invoiceNumber|cfop|cst|csosn|taxRate/i
  );
});

test('fiscal simulation remains a pure contract with no provider or database side effects', () => {
  assert.doesNotMatch(
    fiscalSimulationSource,
    /firebase-admin|adminDb|mercadoLivrePutJson|sendNinetyNineFood|fetch\s*\(/
  );
  assert.match(fiscalSimulationSource, /providerCallAllowed: false/);
  assert.match(fiscalSimulationSource, /sefazCallAllowed: false/);
  assert.match(fiscalSimulationSource, /simulationStatus: 'blocked'/);
});

test('server preflight rereads canonical evidence and exposes only an owner-only GET', () => {
  assert.match(fiscalPreflightServiceSource, /tenants\/\$\{tenantId\}/);
  assert.match(fiscalPreflightServiceSource, /stores\/\$\{canonicalStoreId\}\/orders\/\$\{orderId\}/);
  assert.match(fiscalPreflightServiceSource, /users\/\$\{tenantId\}\/private_store\/inventory/);
  assert.match(fiscalPreflightServiceSource, /fiscalIssuerProfile/);
  assert.match(fiscalPreflightServiceSource, /productFiscalProfiles/);
  assert.match(fiscalPreflightServiceSource, /order\.paymentStatus === 'paid'/);
  assert.doesNotMatch(fiscalPreflightServiceSource, /request\.body|request\.query/);
  assert.match(
    storeConnectionRouterSource,
    /router\.get\('\/:storeId\/fiscal-preflight\/:orderId'/
  );
  assert.match(storeConnectionRouterSource, /authenticatedOwner/);
});

test('fiscal simulation requires an auditable timestamp instead of inventing one', () => {
  assert.throws(
    () => simulateFiscalPreflight({
      storeId: 'store-1',
      orderId: 'order-invalid-time',
      sourceChannel: 'kyrub',
      commerciallyConfirmed: true,
      items: [],
      simulatedAt: 'not-a-date',
    }),
    /FISCAL_SIMULATION_TIMESTAMP_INVALID/
  );
});
