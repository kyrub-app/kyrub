import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(
  'src/components/store/FiscalTaxExecutionPolicyWorkspace.tsx',
  'utf8'
);
const hostSource = readFileSync(
  'src/components/store/FiscalHomologationPolicyWorkspace.tsx',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/fiscalTaxExecutionPolicyRouter.ts',
  'utf8'
);
const transportSource = readFileSync(
  'server/integrations/storeConnectionsServerlessTransport.ts',
  'utf8'
);

test('tax execution workspace is mounted separately from structural policy and Focus provider', () => {
  assert.match(hostSource, /FiscalHomologationStructuralPolicyWorkspace/);
  assert.match(hostSource, /FiscalTaxExecutionPolicyWorkspace/);
  assert.match(hostSource, /FocusNfceProviderWorkspace/);
  assert.match(hostSource, /<FiscalTaxExecutionPolicyWorkspace user=\{user\} storeId=\{storeId\} \/>/);
});

test('tax choices start empty and are never inferred by the browser', () => {
  assert.match(componentSource, /useState<DocumentFamily>\(''\)/);
  assert.match(componentSource, /useState<TriState>\(''\)/);
  assert.match(componentSource, /operationNature, setOperationNature\] = useState\(''\)/);
  assert.match(componentSource, /issuerTaxRegime, setIssuerTaxRegime\] = useState\(''\)/);
  assert.match(componentSource, /cfop: ''/);
  assert.match(componentSource, /icmsSituation: ''/);
  assert.match(componentSource, /ibsCbsSituation: ''/);
  assert.match(componentSource, /ibsCbsClassification: ''/);
  assert.match(componentSource, /O Kyrub não sugere nem preenche valores tributários automaticamente/);
  assert.doesNotMatch(componentSource, /cfop:\s*['"]\d{4}['"]/i);
  assert.doesNotMatch(componentSource, /icmsSituation:\s*['"][0-9A-Za-z_]+['"]/i);
});

test('tax UI uses owner-protected tax policy routes and never calls emission/provider execution', () => {
  assert.match(componentSource, /fiscal-tax-policy/);
  assert.match(componentSource, /method: 'GET'/);
  assert.match(componentSource, /method: 'PUT'/);
  assert.match(componentSource, /approveForHomologation/);
  assert.doesNotMatch(componentSource, /fiscal-provider\/focus|fiscal-attempt|executeFiscal|adapter\.submit|sefaz/i);
  assert.doesNotMatch(componentSource, />\s*Emitir|id=".*emit/i);
});

test('server owns canonical store, version, environment and fiscal authority', () => {
  assert.match(routerSource, /identity\.uid !== storeId/);
  assert.match(routerSource, /saveFiscalTaxExecutionPolicy\(\{/);
  assert.match(routerSource, /tenantId: identity\.uid/);
  assert.match(routerSource, /requestedByUserId: identity\.uid/);
  assert.match(routerSource, /documentFamily/);
  assert.doesNotMatch(routerSource, /request\.body\?\.(?:storeId|version|policyId|authority|environment)/);
  assert.match(transportSource, /createFiscalTaxExecutionPolicyRouter/);
  assert.match(transportSource, /fiscal-tax-policy/);
});

test('draft and homologation approval remain configuration-only', () => {
  assert.match(componentSource, /Salvar rascunho/);
  assert.match(componentSource, /Aprovar para homologação/);
  assert.match(componentSource, /não chama Focus, SEFAZ ou prefeitura/i);
  assert.match(componentSource, /não emite documento/i);
  assert.match(componentSource, /não habilita produção/i);
});
