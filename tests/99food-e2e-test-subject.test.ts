import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './99food-e2e-status-proof.test.ts';

const subjectSource = readFileSync(
  'src/utils/ninetyNineFoodE2ETestSubject.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/NinetyNineFoodE2EOrderObservationPanel.tsx',
  'utf8'
);

test('99Food E2E window and subject are browser-memory context only', () => {
  assert.match(subjectSource, /const windowByStore = new Map<string, NinetyNineFoodE2ETestWindow>\(\);/);
  assert.match(subjectSource, /const subjectByStore = new Map<string, NinetyNineFoodE2ETestSubject>\(\);/);
  assert.match(subjectSource, /startNinetyNineFoodE2ETestWindow/);
  assert.match(subjectSource, /readNinetyNineFoodE2ETestWindow/);
  assert.match(subjectSource, /readNinetyNineFoodE2ETestSubject/);
  assert.doesNotMatch(
    subjectSource,
    /localStorage|sessionStorage|indexedDB|firebase|firestore|\bfetch\(|axios|setDoc|updateDoc|sendAction|providerWriteAuthorization|authorizationToken/i
  );
});

test('starting a new test window resets only the previously selected local subject', () => {
  const startIndex = subjectSource.indexOf('export const startNinetyNineFoodE2ETestWindow');
  const readIndex = subjectSource.indexOf('export const readNinetyNineFoodE2ETestWindow', startIndex);
  const section = subjectSource.slice(startIndex, readIndex);
  assert.match(section, /const startedAt = new Date\(now\)\.toISOString\(\)/);
  assert.match(section, /windowByStore\.set\(storeId, testWindow\)/);
  assert.match(section, /subjectByStore\.delete\(storeId\)/);
  assert.doesNotMatch(section, /clearOmnichannelE2EEvidence|updateOrderStatus|retry|reconcile|fetch/);
});

test('fresh candidates require processed ingress received at or after the explicit window start', () => {
  const startIndex = subjectSource.indexOf('export const isNinetyNineFoodE2EOrderFreshForWindow');
  const selectIndex = subjectSource.indexOf('export const selectNinetyNineFoodE2ETestSubject', startIndex);
  const section = subjectSource.slice(startIndex, selectIndex);
  assert.match(section, /isoMillis\(item\.inboundEvent\.receivedAt\)/);
  assert.match(section, /isoMillis\(testWindow\.startedAt\)/);
  assert.match(section, /eventReceivedAt >= startedAt/);
  assert.match(section, /item\.inboundEvent\.status === 'processed'/);
  assert.match(section, /clean\(item\.inboundEvent\.eventId, 240\)/);
  assert.match(section, /clean\(item\.orderId, 240\)/);
  assert.match(section, /clean\(item\.externalOrderId, 240\)/);
  assert.doesNotMatch(section, /processedAt\).*>=|updatedAt|createdAt/);
});

test('test subject is selected explicitly from exact fresh order and ingress identities', () => {
  const selectIndex = subjectSource.indexOf('export const selectNinetyNineFoodE2ETestSubject');
  const readIndex = subjectSource.indexOf('export const readNinetyNineFoodE2ETestSubject', selectIndex);
  const section = subjectSource.slice(selectIndex, readIndex);
  assert.match(section, /readNinetyNineFoodE2ETestWindow\(storeId\)/);
  assert.match(section, /isNinetyNineFoodE2EOrderFreshForWindow\(item, testWindow\)/);
  assert.match(section, /orderId/);
  assert.match(section, /externalOrderId/);
  assert.match(section, /inboundEventId/);
  assert.match(section, /inboundEventReceivedAt/);
  assert.match(section, /subjectByStore\.set\(storeId, subject\)/);
  assert.doesNotMatch(section, /items\[0\]|sort\(|latest|recordOmnichannelE2EEvidence|publishNinetyNineFoodStatusWriteResult/);
});

test('observation UI never auto-selects a subject and requires the owner to choose a fresh candidate', () => {
  assert.match(panelSource, /id="kyrub-start-99food-e2e-test-window"/);
  assert.match(panelSource, /startNinetyNineFoodE2ETestWindow\(storeId\)/);
  assert.match(panelSource, /isNinetyNineFoodE2EOrderFreshForWindow\(item, testWindow\)/);
  assert.match(panelSource, /Usar este pedido como cobaia/);
  assert.match(panelSource, /onClick=\{\(\) => chooseSubject\(item\)\}/);
  const observeIndex = panelSource.indexOf('const observe = async');
  const startWindowIndex = panelSource.indexOf('const startWindow =', observeIndex);
  const observeSection = panelSource.slice(observeIndex, startWindowIndex);
  assert.doesNotMatch(observeSection, /selectNinetyNineFoodE2ETestSubject/);
});

test('selected subject can request KDS focus but cannot authorize or perform an order/provider write', () => {
  assert.match(panelSource, /requestCanonicalOrderNavigation\(\{/);
  assert.match(panelSource, /storeId,/);
  assert.match(panelSource, /orderId: subject\.orderId/);
  assert.match(panelSource, /Selecionar ou abrir a cobaia nunca concede autoridade de status/);
  assert.doesNotMatch(
    panelSource,
    /requestNinetyNineFoodStatusWriteAuthority|resolveNinetyNineFoodStatusWriteAuthority|sendNinetyNineFood|updateOrderStatus|retryNinetyNineFood|executeNinetyNineFood|recordOmnichannelE2EEvidence|providerWriteAuthorization|authorizationToken/i
  );
});
