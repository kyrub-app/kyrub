import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildFiscalProviderAdapterRegistry,
  createRuntimeFiscalProviderAdapterRegistry,
  type FiscalProviderAdapter,
} from '../server/integrations/fiscalProviderAdapter';
import { fiscalProviderOutcomePatch } from '../server/integrations/fiscalProviderExecutionService';

const adapterSource = readFileSync(
  'server/integrations/fiscalProviderAdapter.ts',
  'utf8'
);
const configSource = readFileSync(
  'server/integrations/fiscalProviderConfigurationRegistry.ts',
  'utf8'
);
const executionSource = readFileSync(
  'server/integrations/fiscalProviderExecutionService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);

const fakeAdapter: FiscalProviderAdapter = {
  id: 'test-provider',
  version: '1',
  supportedDocumentFamilies: ['nfe', 'nfce', 'nfse'],
  supportedEnvironments: ['sandbox'],
  async submit() {
    return {
      kind: 'authorized',
      externalRequestId: 'external-1',
      providerStatus: 'authorized',
      authorizationProtocol: 'protocol-1',
      accessKey: 'access-key-1',
      documentNumber: '123',
    };
  },
  async getStatus() {
    return {
      kind: 'processing',
      externalRequestId: 'external-1',
      providerStatus: 'processing',
    };
  },
};

test('provider registry is explicit and runtime ships with no selectable provider', () => {
  const testRegistry = buildFiscalProviderAdapterRegistry([fakeAdapter]);
  assert.equal(testRegistry.get('test-provider', '1'), fakeAdapter);
  assert.throws(
    () => testRegistry.get('missing', '1'),
    /FISCAL_PROVIDER_ADAPTER_UNAVAILABLE/
  );
  assert.throws(
    () => createRuntimeFiscalProviderAdapterRegistry().get('test-provider', '1'),
    /FISCAL_PROVIDER_ADAPTER_UNAVAILABLE/
  );
  assert.match(adapterSource, /buildFiscalProviderAdapterRegistry\(\[\]\)/);
  assert.doesNotMatch(adapterSource, /authorized.*mock|mock.*authorized/i);
});

test('normalized provider outcomes preserve deterministic authorization and rejection semantics', () => {
  const authorized = fiscalProviderOutcomePatch({
    currentState: 'processing',
    reconciliation: false,
    outcome: {
      kind: 'authorized',
      externalRequestId: 'external-1',
      providerStatus: 'authorized',
      authorizationProtocol: 'protocol-1',
      accessKey: 'key-1',
      documentNumber: '42',
    },
  });
  assert.equal(authorized.state, 'authorized');
  assert.equal(authorized.authorizationProtocol, 'protocol-1');
  assert.equal(authorized.accessKey, 'key-1');
  assert.equal(authorized.documentNumber, '42');

  const rejected = fiscalProviderOutcomePatch({
    currentState: 'processing',
    reconciliation: false,
    outcome: {
      kind: 'rejected',
      externalRequestId: 'external-2',
      providerStatus: 'rejected',
      code: 'E123',
      safeMessage: 'Documento rejeitado pelo provedor.',
    },
  });
  assert.equal(rejected.state, 'rejected');
  assert.equal(rejected.providerCode, 'E123');
  assert.equal(rejected.authorizationProtocol, null);
  assert.equal(rejected.accessKey, null);
});

test('technical ambiguity can never become blind retry authority', () => {
  const ambiguous = fiscalProviderOutcomePatch({
    currentState: 'processing',
    reconciliation: false,
    outcome: {
      kind: 'technical_ambiguity',
      externalRequestId: null,
      providerStatus: 'timeout',
      safeMessage: 'resultado desconhecido',
    },
  });
  assert.equal(ambiguous.state, 'reconciliation_required');

  const stillPending = fiscalProviderOutcomePatch({
    currentState: 'reconciliation_required',
    reconciliation: true,
    outcome: {
      kind: 'processing',
      externalRequestId: 'external-1',
      providerStatus: 'processing',
    },
  });
  assert.equal(stillPending.state, 'reconciliation_required');
});

test('protected provider configuration is store and document-family scoped', () => {
  assert.match(
    configSource,
    /stores\/\$\{canonicalStoreId\}\/fiscalProviderConfigurations\/\$\{documentFamily\}/
  );
  assert.match(configSource, /server_owned_fiscal_provider_configuration/);
  assert.match(configSource, /environment !== 'sandbox'/);
  assert.match(configSource, /parseGoogleSecretManagerRef\(credentialSecretRef\)/);
  assert.match(configSource, /FISCAL_PROVIDER_NOT_CONFIGURED/);
  assert.doesNotMatch(configSource, /addVersion\(/);
});

test('executor claims persisted attempt before provider submit and resolves secrets server-side', () => {
  const claimIndex = executionSource.indexOf("state: 'processing'");
  const submitIndex = executionSource.indexOf('context.adapter.submit');
  assert.ok(claimIndex >= 0);
  assert.ok(submitIndex > claimIndex);
  assert.match(executionSource, /createKyrubCredentialVault\(\)/);
  assert.match(executionSource, /vault\.readLatest\(configuration\.credentialSecretRef\)/);
  assert.match(executionSource, /FISCAL_ATTEMPT_ALREADY_CLAIMED/);
  assert.match(executionSource, /submission_outcome_unknown/);
  assert.match(executionSource, /reconciliation_required/);
});

test('reconciliation is provider-status read only and never issues a second submit', () => {
  const reconcileStart = executionSource.indexOf(
    'export const reconcileFiscalHomologationAttempt'
  );
  assert.ok(reconcileStart >= 0);
  const reconcileSource = executionSource.slice(reconcileStart);
  assert.match(reconcileSource, /context\.adapter\.getStatus/);
  assert.doesNotMatch(reconcileSource, /context\.adapter\.submit/);
  assert.match(reconcileSource, /FISCAL_ATTEMPT_RECONCILIATION_NOT_ALLOWED/);
});

test('provider boundary remains server-only with no browser execution route or secret exposure', () => {
  assert.doesNotMatch(routerSource, /fiscal-attempt|fiscal-execution|fiscal-provider/i);
  assert.doesNotMatch(executionSource, /credential:\s*.*return/);
  assert.doesNotMatch(executionSource, /console\.(log|error|warn).*credential/i);
  assert.doesNotMatch(configSource, /request\.(body|query|params)/);
});
