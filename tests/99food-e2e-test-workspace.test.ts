import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const clientSource = readFileSync('src/utils/ninetyNineFoodE2ETest.ts', 'utf8');
const workspaceSource = readFileSync('src/components/store/NinetyNineFoodE2ETestWorkspace.tsx', 'utf8');
const bridgeSource = readFileSync('src/components/store/NinetyNineFoodE2ETestBridge.tsx', 'utf8');
const portalSource = readFileSync('src/components/store/StoreConnectionsPortalBridge.tsx', 'utf8');

test('99Food E2E client follows the complete controlled availability route chain', () => {
  assert.match(clientSource, /\/api\/integrations\/99food\/product-bindings/);
  assert.match(clientSource, /\/capabilities\/menu\/discover/);
  assert.match(clientSource, /\/catalog-identity\/resolve/);
  assert.match(clientSource, /\/api\/orders\/availability\/\$\{encoded\(canonicalStoreId\)\}\/policies\/99food/);
  assert.match(clientSource, /\/snapshots\/99food/);
  assert.match(clientSource, /\/availability-proposals/);
  assert.match(clientSource, /\/authorize/);
  assert.match(clientSource, /\/availability-authorizations\/\$\{encoded\(authorizationId\)\}\/execute/);
  assert.match(clientSource, /\/availability-executions\/\$\{encoded\(executionId\)\}\/reconcile/);
});

test('workspace keeps raw one-time authorization token only in React memory', () => {
  assert.match(workspaceSource, /useState\(''\).*authorizationToken|authorizationToken, setAuthorizationToken/s);
  assert.match(workspaceSource, /setAuthorizationToken\(result\.authorizationToken\)/);
  assert.match(workspaceSource, /setAuthorizationToken\(''\)/);
  assert.doesNotMatch(workspaceSource, /localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(clientSource, /localStorage|sessionStorage|indexedDB/);
});

test('authorization and real provider write remain separate explicit user actions', () => {
  assert.match(workspaceSource, /handleAuthorize/);
  assert.match(workspaceSource, /authorizeNinetyNineFoodE2EAvailability/);
  assert.match(workspaceSource, /handleExecute/);
  assert.match(workspaceSource, /executeNinetyNineFoodE2EAvailability/);
  assert.match(workspaceSource, /6\. Autorizar alteração/);
  assert.match(workspaceSource, /7\. Alterar disponibilidade na 99Food agora/);
  assert.match(workspaceSource, /PATCH real/);
  assert.doesNotMatch(workspaceSource, /handleAuthorize[\s\S]{0,900}executeNinetyNineFoodE2EAvailability/);
});

test('workspace uses frozen server-returned identifiers after binding selection', () => {
  assert.match(workspaceSource, /selected\.canonicalStoreId/);
  assert.match(workspaceSource, /selected\.canonicalProductId/);
  assert.match(workspaceSource, /selected\.externalProductId/);
  assert.match(workspaceSource, /snapshot\.snapshotId/);
  assert.match(workspaceSource, /proposal\.id/);
  assert.match(workspaceSource, /authorization\.id/);
  assert.match(workspaceSource, /execution\.id/);
});

test('reconciliation is explicit and no provider retry loop exists in the test workspace', () => {
  assert.match(workspaceSource, /8\. Reconciliar com a 99Food/);
  assert.match(workspaceSource, /reconcileNinetyNineFoodE2EAvailability/);
  assert.match(workspaceSource, /Nenhum retry automático será feito/);
  assert.doesNotMatch(workspaceSource, /while\s*\(|setInterval|for\s*\([^)]*attempt/i);
});

test('99Food E2E workspace only renders behind a connected 99Food bridge and is mounted in store connections portal', () => {
  assert.match(bridgeSource, /getNinetyNineFoodConnectionStatus/);
  assert.match(bridgeSource, /status\.status === 'connected'/);
  assert.match(bridgeSource, /if \(!connected\) return null/);
  assert.match(portalSource, /NinetyNineFoodE2ETestBridge/);
  assert.match(portalSource, /<NinetyNineFoodE2ETestBridge notify=\{notify\} \/>/);
});

test('test workspace does not emit fiscal documents or mutate canonical inventory directly', () => {
  assert.doesNotMatch(workspaceSource, /emit.*(?:nfe|nfce|nfse)|inventoryLedger|physicalQuantity\s*:|reservationStatus\s*:/i);
  assert.doesNotMatch(clientSource, /emit.*(?:nfe|nfce|nfse)|inventoryLedger|physicalQuantity\s*:|reservationStatus\s*:/i);
});
