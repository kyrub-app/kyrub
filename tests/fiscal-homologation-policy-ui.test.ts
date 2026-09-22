import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridgeSource = readFileSync(
  'src/components/store/FiscalHomologationTabBridge.tsx',
  'utf8'
);
const policyUiSource = readFileSync(
  'src/components/store/FiscalHomologationPolicyWorkspace.tsx',
  'utf8'
);

test('homologation tab mounts policy editor before canonical order preflight', () => {
  assert.match(bridgeSource, /FiscalHomologationPolicyWorkspace/);
  assert.match(bridgeSource, /FiscalPreflightWorkspace/);
  assert.ok(
    bridgeSource.indexOf('<FiscalHomologationPolicyWorkspace') <
      bridgeSource.indexOf('<FiscalPreflightWorkspace')
  );
});

test('policy UI loads and saves only through the owner fiscal policy API', () => {
  assert.match(policyUiSource, /user\.getIdToken\(\)/);
  assert.match(
    policyUiSource,
    /\/api\/store-connections\/\$\{encodeURIComponent\(storeId\)\}\/fiscal-policy\/homologation/
  );
  assert.match(policyUiSource, /method: 'GET'/);
  assert.match(policyUiSource, /method: 'PUT'/);
  assert.match(policyUiSource, /cache: 'no-store'/);
});

test('policy UI starts without inferred fiscal choices', () => {
  assert.match(policyUiSource, /useState<OperationScope>\(''\)/);
  assert.match(policyUiSource, /useState<DocumentFamily>\(''\)/);
  assert.match(policyUiSource, /useState<OperationalTrigger>\(''\)/);
  assert.match(policyUiSource, /<option value="">Selecione conforme orientação<\/option>/);
  assert.doesNotMatch(policyUiSource, /useState<DocumentFamily>\('(nfe|nfce|nfse)'\)/);
  assert.doesNotMatch(
    policyUiSource,
    /useState<OperationalTrigger>\('(payment_confirmed|fulfillment_confirmed|service_completed)'\)/
  );
});

test('policy UI submits only explicit policy choices and no authority fields', () => {
  const bodyStart = policyUiSource.indexOf('body: JSON.stringify({');
  const bodyEnd = policyUiSource.indexOf('}),', bodyStart);
  const body = policyUiSource.slice(bodyStart, bodyEnd);

  assert.match(body, /policyReference/);
  assert.match(body, /effectiveFrom/);
  assert.match(body, /operationScope/);
  assert.match(body, /documentFamily/);
  assert.match(body, /operationalTrigger/);
  assert.match(body, /approveForHomologation/);
  assert.doesNotMatch(body, /canonicalStoreId|policyId|version|environment|emissionAuthority|providerCallAllowed|sefazCallAllowed/);
});

test('approval remains explicitly homologation-only with production and emission blocked', () => {
  assert.match(policyUiSource, /Aprovar para homologação/);
  assert.match(policyUiSource, /Produção bloqueada/);
  assert.match(policyUiSource, /Produção e emissão continuam bloqueadas/);
  assert.match(policyUiSource, /não habilita produção, não chama SEFAZ e não emite nota/);
  assert.doesNotMatch(policyUiSource, />\s*Emitir nota\s*</i);
});

test('policy approval requires every explicit field before the request', () => {
  assert.match(policyUiSource, /if \(approveForHomologation && missingInputs\.length > 0\)/);
  assert.match(policyUiSource, /policy_reference/);
  assert.match(policyUiSource, /effective_from/);
  assert.match(policyUiSource, /operation_scope/);
  assert.match(policyUiSource, /document_family/);
  assert.match(policyUiSource, /operational_trigger/);
});
