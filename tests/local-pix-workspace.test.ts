import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const recoverySource = readFileSync(
  'server/attendance/localPendingPixService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/attendance/localAttendanceRouter.ts',
  'utf8'
);
const clientSource = readFileSync(
  'src/utils/localPixCheckout.ts',
  'utf8'
);
const panelSource = readFileSync(
  'src/components/store/ServiceLocationFinancialContextPanel.tsx',
  'utf8'
);
const workspaceSource = readFileSync(
  'src/components/store/ServiceLocationOperationalWorkspaceBridge.tsx',
  'utf8'
);

test('pending Pix recovery is store and order scoped and ignores recognized legacy mirrors', () => {
  assert.match(recoverySource, /target\.orderId/);
  assert.match(recoverySource, /where\('orderId', '==', orderId\)/);
  assert.match(recoverySource, /legacy_table_payment_mirror/);
  assert.match(recoverySource, /pairs\.length !== 1/);
  assert.match(recoverySource, /LOCAL_PIX_RECOVERY_AMBIGUOUS/);
  assert.match(recoverySource, /getMercadoPagoPixCheckout/);
  assert.match(recoverySource, /actorUserId !== storeId/);
});

test('authenticated local attendance API exposes recovery without accepting financial overrides', () => {
  assert.match(routerSource, /router\.get\('\/payment-intents\/pending-pix'/);
  assert.match(routerSource, /requireStoreAuthority/);
  assert.match(routerSource, /loadPendingLocalPixAttempt/);
  const recoveryStart = routerSource.indexOf("router.get('/payment-intents/pending-pix'");
  const recoveryEnd = routerSource.indexOf("router.post('/payment-intents'", recoveryStart);
  const recoveryRoute = routerSource.slice(recoveryStart, recoveryEnd);
  assert.doesNotMatch(recoveryRoute, /amount|email|buyerId|context|method/);
});

test('browser flow recovers a pending Pix before creating a new intent', () => {
  const recoverIndex = clientSource.indexOf('/payment-intents/pending-pix');
  const createIndex = clientSource.indexOf("'/api/local-attendance/payment-intents'");
  assert.ok(recoverIndex >= 0 && createIndex > recoverIndex);
  assert.match(clientSource, /recovered\.attempt/);
  assert.match(clientSource, /attempt\.providerAttached && attempt\.checkout/);
  assert.match(clientSource, /paymentIntentId: attempt\.paymentIntentId/);
  assert.match(clientSource, /paymentId: attempt\.paymentId/);
  assert.doesNotMatch(clientSource, /body: JSON\.stringify\([^)]*(amount|email|buyerId|context|method)/s);
});

test('workspace exposes Pix from canonical financial context without projecting line settlement', () => {
  assert.match(panelSource, /openOrCreateLocalPixCheckout/);
  assert.match(panelSource, /Gerar Pix do saldo/);
  assert.match(panelSource, /Abrir Pix pendente/);
  assert.match(panelSource, /Aguardando confirmação autoritativa do Mercado Pago/);
  assert.match(panelSource, /Copiar Pix copia e cola/);
  assert.doesNotMatch(panelSource, /paidQuantity\s*[:=]/);
  assert.doesNotMatch(panelSource, /paymentStatus\s*[:=]/);
  assert.match(workspaceSource, /cobrança Pix canônica/);
  assert.match(workspaceSource, /quitação depende do webhook verificado/);
  assert.match(workspaceSource, /transferências\/alocação por item continuam fora/);
});
