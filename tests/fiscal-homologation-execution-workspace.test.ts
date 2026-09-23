import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const executionSource = readFileSync(
  'src/components/store/FiscalHomologationExecutionWorkspace.tsx',
  'utf8'
);
const bridgeSource = readFileSync(
  'src/components/store/FiscalHomologationManualExecutionWorkspace.tsx',
  'utf8'
);
const hostSource = readFileSync(
  'src/components/store/FiscalHomologationPolicyWorkspace.tsx',
  'utf8'
);

test('execution bridge is mounted in fiscal homologation workspace', () => {
  assert.match(hostSource, /FiscalHomologationManualExecutionWorkspace/);
  assert.match(hostSource, /<FiscalHomologationManualExecutionWorkspace user=\{user\} storeId=\{storeId\} \/>/);
  assert.match(bridgeSource, /mesmo ID canônico que foi analisado no pré-flight/);
  assert.match(bridgeSource, /documentFamily="nfce"/);
});

test('preparation is a distinct provider-free action before external submit', () => {
  assert.match(executionSource, /orders\/\$\{encodeURIComponent\(orderId\)\}\/prepare/);
  assert.match(executionSource, /providerCallMade !== false/);
  assert.match(executionSource, /sefazCallMade !== false/);
  assert.match(executionSource, /Nenhum documento foi enviado à Focus/);
  assert.match(executionSource, /Preparar homologação/);
});

test('Focus submit requires protected readiness and an explicit user confirmation', () => {
  assert.match(executionSource, /focusReadiness\?\.configured === true/);
  assert.match(executionSource, /focusReadiness\.active === true/);
  assert.match(executionSource, /focusReadiness\.credentialPresent === true/);
  assert.match(executionSource, /confirm-fiscal-homologation-submit/);
  assert.match(executionSource, /confirmed && !busy/);
  assert.match(executionSource, /Emitir NFC-e em homologação/);
  assert.match(executionSource, /não é emissão de produção/i);
});

test('reconciliation is separate and the UI never offers blind resubmit', () => {
  assert.match(executionSource, /attempts\/\$\{encodeURIComponent\(attemptId\)\}\/reconcile/);
  assert.match(executionSource, /resubmitted: false/);
  assert.match(executionSource, /Reconciliar com a Focus/);
  assert.match(executionSource, /antes de qualquer nova ação/);
  assert.doesNotMatch(executionSource, /Tentar novamente|Reenviar NFC-e|Reemitir/i);
});

test('the UI is NFC-e sandbox only and does not expose production execution', () => {
  assert.match(executionSource, /documentFamily !== 'nfce'/);
  assert.match(executionSource, /NF-e e NFS-e continuam fail-closed/);
  assert.match(executionSource, /environment !== 'sandbox'/);
  assert.doesNotMatch(executionSource, /environment:\s*'production'/);
  assert.doesNotMatch(executionSource, /Emitir.*produção|Produção.*Emitir/i);
});

test('manual bridge validates order ids and does not create fiscal authority client-side', () => {
  assert.match(bridgeSource, /\^\[a-zA-Z0-9:_-\]\{1,240\}\$/);
  assert.match(bridgeSource, /digitar o ID não concede autoridade de emissão/i);
  assert.doesNotMatch(bridgeSource, /policy|cfop|cst|providerCallAllowed|authority:/i);
});
