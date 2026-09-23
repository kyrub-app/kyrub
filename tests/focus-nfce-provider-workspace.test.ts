import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const componentSource = readFileSync(
  'src/components/store/FocusNfceProviderWorkspace.tsx',
  'utf8'
);
const hostSource = readFileSync(
  'src/components/store/FiscalHomologationPolicyWorkspace.tsx',
  'utf8'
);

test('Focus NFC-e sandbox connection card is mounted inside fiscal homologation workspace', () => {
  assert.match(
    hostSource,
    /import FocusNfceProviderWorkspace from '\.\/FocusNfceProviderWorkspace'/
  );
  assert.match(
    hostSource,
    /<FocusNfceProviderWorkspace\s+user=\{user\}\s+storeId=\{storeId\}\s*\/>/
  );
});

test('Focus token stays ephemeral and password-masked in browser state', () => {
  assert.match(componentSource, /const \[token, setToken\] = useState\(''\)/);
  assert.match(componentSource, /type="password"/);
  assert.match(componentSource, /autoComplete="new-password"/);
  assert.match(componentSource, /JSON\.stringify\(\{ token: normalizedToken \}\)/);
  assert.match(componentSource, /setToken\(''\)/);
  assert.doesNotMatch(componentSource, /localStorage|sessionStorage|indexedDB/i);
});

test('connection card uses protected onboarding routes only', () => {
  assert.match(componentSource, /fiscal-provider\/focus-nfce/);
  assert.match(componentSource, /method: 'GET'/);
  assert.match(componentSource, /method: 'PUT'/);
  assert.match(componentSource, /\$\{endpoint\}\/\$\{action\}/);
  assert.match(componentSource, /'deactivate' \| 'reactivate'/);
  assert.doesNotMatch(componentSource, /fiscal-attempt|executeFiscal|adapter\.submit|sefaz|emitir nota/i);
});

test('safe readiness model never exposes protected secret topology', () => {
  const interfaceStart = componentSource.indexOf('interface FocusNfceProviderReadiness');
  const interfaceEnd = componentSource.indexOf('\n}', interfaceStart);
  assert.ok(interfaceStart >= 0 && interfaceEnd > interfaceStart);
  const readModel = componentSource.slice(interfaceStart, interfaceEnd);
  assert.doesNotMatch(readModel, /credentialSecretRef|secretRef|resourceName|projectId|token/i);
  assert.match(readModel, /credentialPresent: boolean/);
  assert.match(readModel, /verificationStatus:/);
  assert.doesNotMatch(componentSource, /credentialSecretRef|secretRef|resourceName|Secret Manager project/i);
});

test('connection UI remains homologation-only and does not alter accounting policy', () => {
  assert.match(componentSource, /homologação/i);
  assert.match(componentSource, /não envia documento/i);
  assert.match(componentSource, /não altera a política fiscal/i);
  assert.match(componentSource, /não escolhe CFOP, CST ou classificação IBS\/CBS/i);
  assert.doesNotMatch(componentSource, /approveForHomologation|policyReference|operationalTrigger/);
  assert.doesNotMatch(componentSource, />\s*Emitir|id=".*emit/i);
});
