import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './99food-e2e-order-observation.test.ts';

const evidenceSource = readFileSync(
  'src/utils/omnichannelE2EEvidence.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/OmnichannelE2EEvidencePanel.tsx',
  'utf8'
);
const mercadoLivreSource = readFileSync(
  'src/utils/mercadoLivreE2ETest.ts',
  'utf8'
);
const availabilitySource = readFileSync(
  'src/utils/ninetyNineFoodE2ETest.ts',
  'utf8'
);
const statusDecisionSource = readFileSync(
  'src/utils/ninetyNineFoodStatusWriteAuthority.ts',
  'utf8'
);
const manualStatusSource = readFileSync(
  'src/utils/ninetyNineFoodPendingStatusSync.ts',
  'utf8'
);
const statusReconciliationSource = readFileSync(
  'src/utils/ninetyNineFoodStatusSyncReconciliation.ts',
  'utf8'
);
const portalSource = readFileSync(
  'src/components/store/StoreConnectionsPortalBridge.tsx',
  'utf8'
);

test('E2E evidence storage is bounded memory-only observability with no network or durable persistence', () => {
  assert.match(evidenceSource, /const evidenceByStore = new Map<string, OmnichannelE2EEvidenceRecord\[]>\(\);/);
  assert.match(evidenceSource, /\.slice\(0, 50\)/);
  assert.match(evidenceSource, /recordOmnichannelE2EEvidence/);
  assert.match(evidenceSource, /readOmnichannelE2EEvidence/);
  assert.match(evidenceSource, /clearOmnichannelE2EEvidence/);
  assert.doesNotMatch(
    evidenceSource,
    /localStorage|sessionStorage|indexedDB|firebase|firestore|\bfetch\(|axios|setDoc|updateDoc|sendAction|authorize|execute|retry|reconcile/i
  );
});

test('Mercado Livre evidence is emitted only after publication and stock reconciliation readbacks return', () => {
  const publicationStart = mercadoLivreSource.indexOf('export const reconcileMercadoLivreE2EPublication = async');
  const stockStart = mercadoLivreSource.indexOf('export const reconcileMercadoLivreE2EStock = async');
  const publicationFetch = mercadoLivreSource.indexOf('const result = await authorizedFetch', publicationStart);
  const publicationRecord = mercadoLivreSource.indexOf('recordOmnichannelE2EEvidence({', publicationFetch);
  const stockFetch = mercadoLivreSource.indexOf('const result = await authorizedFetch', stockStart);
  const stockRecord = mercadoLivreSource.indexOf('recordOmnichannelE2EEvidence({', stockFetch);
  assert.ok(publicationStart >= 0);
  assert.ok(publicationFetch > publicationStart);
  assert.ok(publicationRecord > publicationFetch);
  assert.ok(stockStart > publicationRecord);
  assert.ok(stockFetch > stockStart);
  assert.ok(stockRecord > stockFetch);
  assert.match(mercadoLivreSource.slice(publicationRecord, stockStart), /source: 'provider_readback'/);
  assert.match(mercadoLivreSource.slice(stockRecord), /source: 'provider_readback'/);
});

test('99Food availability evidence is recorded after reconciliation response and preserves reconciled versus divergent outcome', () => {
  const start = availabilitySource.indexOf('export const reconcileNinetyNineFoodE2EAvailability = async');
  const response = availabilitySource.indexOf('const result = await authorizedRequest', start);
  const record = availabilitySource.indexOf('recordOmnichannelE2EEvidence({', response);
  assert.ok(start >= 0);
  assert.ok(response > start);
  assert.ok(record > response);
  assert.match(availabilitySource.slice(record), /kind: '99food_availability'/);
  assert.match(availabilitySource.slice(record), /source: 'provider_readback'/);
  assert.match(availabilitySource.slice(record), /outcome: result\.status/);
});

test('99Food status decision evidence is emitted from authoritative result publication, never from request or choice resolution', () => {
  const requestStart = statusDecisionSource.indexOf('export const requestNinetyNineFoodStatusWriteAuthority');
  const resolveStart = statusDecisionSource.indexOf('export const resolveNinetyNineFoodStatusWriteAuthority', requestStart);
  const publishStart = statusDecisionSource.indexOf('export const publishNinetyNineFoodStatusWriteResult', resolveStart);
  const requestSection = statusDecisionSource.slice(requestStart, resolveStart);
  const resolveSection = statusDecisionSource.slice(resolveStart, publishStart);
  const publishSection = statusDecisionSource.slice(publishStart);
  assert.doesNotMatch(requestSection, /recordOmnichannelE2EEvidence/);
  assert.doesNotMatch(resolveSection, /recordOmnichannelE2EEvidence/);
  assert.match(publishSection, /recordOmnichannelE2EEvidence/);
  assert.match(publishSection, /partnerSync !== 'not-applicable'/);
  assert.match(publishSection, /outcome: result\.partnerSync/);
});

test('manual 99Food status evidence requires exact parsed response and localTransitionApplied false before recording', () => {
  const validationIndex = manualStatusSource.indexOf("throw new Error('A resposta autoritativa da sincronização 99Food está incompleta.')");
  const resultIndex = manualStatusSource.indexOf('const result: NinetyNineFoodPendingStatusSyncResult', validationIndex);
  const recordIndex = manualStatusSource.indexOf('recordOmnichannelE2EEvidence({', resultIndex);
  assert.ok(validationIndex >= 0);
  assert.ok(resultIndex > validationIndex);
  assert.ok(recordIndex > resultIndex);
  assert.match(manualStatusSource.slice(resultIndex, recordIndex), /localTransitionApplied: false/);
  assert.match(manualStatusSource.slice(recordIndex), /orderRevision: resultOrderRevision/);
  assert.match(manualStatusSource.slice(recordIndex), /executionId/);
  assert.match(manualStatusSource.slice(recordIndex), /outcome: partnerSync/);
});

test('status reconciliation evidence records provider readback outcome without creating a new provider write', () => {
  const validationIndex = statusReconciliationSource.indexOf("throw new Error('A resposta autoritativa da reconciliação 99Food está incompleta.')");
  const resultIndex = statusReconciliationSource.indexOf('const result: NinetyNineFoodStatusSyncReconciliationResult', validationIndex);
  const recordIndex = statusReconciliationSource.indexOf('recordOmnichannelE2EEvidence({', resultIndex);
  assert.ok(validationIndex >= 0);
  assert.ok(resultIndex > validationIndex);
  assert.ok(recordIndex > resultIndex);
  assert.match(statusReconciliationSource.slice(recordIndex), /source: 'provider_readback'/);
  assert.match(statusReconciliationSource.slice(recordIndex), /providerWriteAttempted: false/);
  assert.match(statusReconciliationSource.slice(recordIndex), /localTransitionApplied: false/);
});

test('evidence panel can only read or clear session evidence and cannot perform provider or Kyrub operations', () => {
  assert.match(panelSource, /readOmnichannelE2EEvidence/);
  assert.match(panelSource, /clearOmnichannelE2EEvidence/);
  assert.match(panelSource, /desaparece com o reload da página/);
  assert.match(panelSource, /Nenhum código de autorização, orderRevision, executionId ou resultado mostrado aqui pode ser consumido/);
  assert.doesNotMatch(
    panelSource,
    /\bfetch\(|authorize|execute|retry|reconcile|sendNinetyNineFood|updateOrderStatus|setDoc|updateDoc|localStorage|sessionStorage/i
  );
});

test('store portal mounts evidence after runbook without replacing readiness or provider benches', () => {
  const readinessIndex = portalSource.indexOf('<OmnichannelE2EReadinessPanel');
  const runbookIndex = portalSource.indexOf('<OmnichannelE2ERunbookPanel');
  const evidenceIndex = portalSource.indexOf('<OmnichannelE2EEvidencePanel');
  const mercadoLivreIndex = portalSource.indexOf('<MercadoLivreE2ETestBridge');
  const ninetyNineFoodIndex = portalSource.indexOf('<NinetyNineFoodE2ETestBridge');
  assert.match(portalSource, /import OmnichannelE2EEvidencePanel/);
  assert.ok(readinessIndex >= 0);
  assert.ok(runbookIndex > readinessIndex);
  assert.ok(evidenceIndex > runbookIndex);
  assert.ok(mercadoLivreIndex > evidenceIndex);
  assert.ok(ninetyNineFoodIndex > evidenceIndex);
});
