import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const proofSource = readFileSync(
  'src/utils/ninetyNineFoodE2EStatusProof.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/NinetyNineFoodE2EStatusProofPanel.tsx',
  'utf8'
);
const proofBridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodE2EStatusProofBridge.tsx',
  'utf8'
);
const e2eBridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodE2ETestBridge.tsx',
  'utf8'
);

test('status proof is owner-bound and observes only the selected subject after selection', () => {
  assert.match(proofSource, /user\.uid !== subject\.storeId/);
  assert.match(proofSource, /readOmnichannelE2EEvidence\(subject\.storeId\)/);
  assert.match(proofSource, /after\(record, subject\.selectedAt\)/);
  assert.match(proofSource, /detailString\(record, 'orderId'\) === subject\.orderId/);
  assert.match(proofSource, /item\.orderId === subject\.orderId/);
  assert.match(proofSource, /item\.externalOrderId === subject\.externalOrderId/);
});

test('Kyrub-only proof comes from authorization-required evidence or current authoritative pending queue only', () => {
  assert.match(proofSource, /record\.outcome === 'authorization-required'/);
  assert.match(proofSource, /pending\?\.outboundStatus === 'authorization_required'/);
  assert.match(proofSource, /source: pending\?\.outboundStatus === 'authorization_required'/);
  assert.match(proofSource, /'authoritative_pending_queue'/);
  assert.match(proofSource, /pending\?\.status === kyrubOnlyStatus \? pending\.orderRevision : ''/);
  assert.doesNotMatch(proofSource, /orderRevision:\s*subject\.|orderRevision:\s*kyrubOnlyEvidence/);
});

test('manual status proof requires an explicit false localTransitionApplied value', () => {
  assert.match(proofSource, /record\.details\[key\] === false/);
  assert.match(proofSource, /detailIsFalse\(manualEvidence, 'localTransitionApplied'\)/);
  assert.match(proofSource, /outcome === 'sent' && noLocalReplay/);
  assert.match(proofSource, /localTransitionApplied = false/);
  assert.match(proofSource, /reconciliation_required/);
  assert.match(proofSource, /não faça uma nova tentativa automática/);
});

test('multiple manual sends fail closed instead of choosing latest-wins evidence', () => {
  assert.match(proofSource, /const multipleManualSyncs = manualRecords\.length > 1/);
  assert.match(proofSource, /manualRecords\.length === 1 \? manualRecords\[0\] : null/);
  assert.match(proofSource, /state: 'blocked'/);
  assert.match(proofSource, /Mais de um envio manual foi observado/);
  assert.match(proofSource, /não escolha automaticamente um deles/);
  assert.doesNotMatch(proofSource, /manualRecords\[0\] \?\? null/);
});

test('final direct proof must be later than manual evidence and use a different status', () => {
  assert.match(proofSource, /laterThan\(record, manualAt\)/);
  assert.match(proofSource, /detailString\(record, 'status'\) !== manualStatus/);
  assert.match(proofSource, /record\.outcome === 'sent' \|\| record\.outcome === 'attention'/);
  assert.match(proofSource, /manualSync\.state === 'proven'/);
  assert.match(proofSource, /Uma transição posterior e diferente/);
});

test('out-of-order or repeated Kyrub-only decisions are warnings and never auto-corrected', () => {
  assert.match(proofSource, /directBeforeManual/);
  assert.match(proofSource, /secondKyrubOnly/);
  assert.match(proofSource, /não conte isso como a transição final do roteiro/);
  assert.match(proofSource, /ainda falta provar uma autorização Kyrub \+ 99Food nova/);
  assert.doesNotMatch(
    proofSource,
    /sendNinetyNineFoodPendingStatusSync|requestNinetyNineFoodStatusWriteAuthority|resolveNinetyNineFoodStatusWriteAuthority|updateOrderStatus|retryNinetyNineFood|reconcileNinetyNineFoodStatusSyncExecution|authorizationToken|providerWriteAuthorization/i
  );
});

test('status proof reads the existing pending GET and session evidence but creates no new network/write path', () => {
  assert.match(proofSource, /loadNinetyNineFoodPendingStatusSyncs\(user\)/);
  assert.match(proofSource, /readOmnichannelE2EEvidence/);
  assert.doesNotMatch(
    proofSource,
    /\bfetch\(|axios|setDoc|updateDoc|firebase|firestore|setInterval|setTimeout/i
  );
});

test('status proof panel has one read action and no operational status/provider button', () => {
  assert.match(panelSource, /loadNinetyNineFoodE2EStatusProof\(user, subject\)/);
  assert.match(panelSource, /id="kyrub-refresh-99food-e2e-status-proof"/);
  assert.match(panelSource, /Kyrub-only gera pendência de revisão exata/);
  assert.match(panelSource, /Envio manual não repete a transição local/);
  assert.match(panelSource, /Status seguinte usa Kyrub \+ 99Food/);
  assert.match(panelSource, /nunca faz retry automático/);
  assert.doesNotMatch(
    panelSource,
    /sendNinetyNineFood|updateOrderStatus|retryNinetyNineFood|authorizeNinetyNineFood|executeNinetyNineFood|reconcileNinetyNineFood|providerWriteAuthorization|authorizationToken|\bfetch\(|setInterval|setTimeout/i
  );
});

test('subject proof bridge reacts only to local subject context and mounts after observation', () => {
  assert.match(proofBridgeSource, /readNinetyNineFoodE2ETestSubject\(user\.uid\)/);
  assert.match(proofBridgeSource, /KYRUB_99FOOD_E2E_TEST_SUBJECT_CHANGED_EVENT/);
  assert.match(proofBridgeSource, /if \(!subject\) return null/);
  assert.match(proofBridgeSource, /<NinetyNineFoodE2EStatusProofPanel user=\{user\} subject=\{subject\} \/>/);
  assert.doesNotMatch(proofBridgeSource, /fetch\(|updateOrderStatus|sendNinetyNineFood|authorize|execute|retry|reconcile/);

  const observationIndex = e2eBridgeSource.indexOf('<NinetyNineFoodE2EOrderObservationPanel');
  const proofIndex = e2eBridgeSource.indexOf('<NinetyNineFoodE2EStatusProofBridge');
  assert.ok(observationIndex >= 0);
  assert.ok(proofIndex > observationIndex);
});
