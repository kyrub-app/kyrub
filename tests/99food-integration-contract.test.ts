import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serverSource = readFileSync('server.ts', 'utf8');
const routerSource = readFileSync(
  'server/integrations/ninetyNineFoodRouter.ts',
  'utf8'
);
const serviceSource = readFileSync(
  'server/integrations/ninetyNineFoodService.ts',
  'utf8'
);
const protocolSource = readFileSync(
  'server/integrations/openDelivery.ts',
  'utf8'
);
const vaultSource = readFileSync(
  'server/integrations/secretVault.ts',
  'utf8'
);
const frontendSource = readFileSync(
  'src/components/store/NinetyNineFoodConnectionBridge.tsx',
  'utf8'
);
const statusBridgeSource = readFileSync(
  'src/components/store/NinetyNineFoodOrderStatusBridge.tsx',
  'utf8'
);
const statusAuthoritySource = readFileSync(
  'src/utils/ninetyNineFoodStatusWriteAuthority.ts',
  'utf8'
);
const appSource = readFileSync('src/App.tsx', 'utf8');
const packageSource = readFileSync('package.json', 'utf8');

test('server exposes authenticated setup, webhook, polling and order status routes', () => {
  assert.match(serverSource, /createNinetyNineFoodRouter/);
  assert.match(serverSource, /express\.json\([\s\S]*verify:/);
  assert.match(routerSource, /verifyIdToken/);
  assert.match(routerSource, /router\.post\('\/connect'/);
  assert.match(routerSource, /router\.post\('\/poll'/);
  assert.match(routerSource, /router\.post\('\/v1\/newEvent'/);
  assert.match(routerSource, /orders\/:externalOrderId\/status/);
  assert.match(routerSource, /INTEGRATION_CRON_SECRET/);
});

test('credentials stay server-side and are encrypted before persistence', () => {
  assert.match(vaultSource, /aes-256-gcm/);
  assert.match(vaultSource, /setAAD/);
  assert.match(vaultSource, /timingSafeEqual/);
  assert.match(serviceSource, /encryptedCredentials/);
  assert.match(serviceSource, /getIntegrationMasterKey/);
  assert.doesNotMatch(frontendSource, /localStorage/);
  assert.match(frontendSource, /type="password"/);
  assert.match(frontendSource, /Client Secret/);
});

test('webhooks are authenticated and events are idempotent and retryable', () => {
  assert.match(routerSource, /x-app-merchantid/);
  assert.match(routerSource, /x-app-signature/);
  assert.match(serviceSource, /verifyOpenDeliverySignature/);
  assert.match(serviceSource, /integrationEvents/);
  assert.match(serviceSource, /runTransaction/);
  assert.match(serviceSource, /leaseExpiresAt/);
  assert.match(serviceSource, /status: 'failed'/);
  assert.match(serviceSource, /duplicate: true/);
  assert.match(serviceSource, /acknowledgeEvents\(acknowledged\)/);
});

test('Open Delivery client supports OAuth, webhook registration and polling acknowledgment', () => {
  assert.match(protocolSource, /grant_type: 'client_credentials'/);
  assert.match(protocolSource, /authorization: `Bearer \$\{token\}`/);
  assert.match(protocolSource, /\/v1\/merchantOnboarding/);
  assert.match(protocolSource, /\/v1\/events:polling/);
  assert.match(protocolSource, /\/v1\/events\/acknowledgment/);
  assert.match(protocolSource, /\/readyForPickup/);
  assert.match(protocolSource, /\/requestCancellation/);
});

test('real orders are written to the current KDS collection and canonical mirror', () => {
  assert.match(serviceSource, /artifacts\/\$\{tenantId\}\/public\/data\/customerOrders/);
  assert.match(serviceSource, /stores\/\$\{canonicalStoreId\}\/orders/);
  assert.match(serviceSource, /normalizeOpenDeliveryOrder/);
  assert.match(serviceSource, /routingTarget/);
});

test('connection and KDS status bridges are mounted with explicit provider-write authority and without platform secrets', () => {
  assert.match(appSource, /NinetyNineFoodConnectionBridge/);
  assert.match(appSource, /NinetyNineFoodOrderStatusBridge/);
  assert.match(statusBridgeSource, /kyrub-99food-status-write-authority/);
  assert.match(statusBridgeSource, /Atualizar só no Kyrub/);
  assert.match(statusBridgeSource, /Kyrub \+ 99Food/);
  assert.match(statusAuthoritySource, /kyrub:99food-status-write-authority-requested/);
  assert.doesNotMatch(statusBridgeSource, /metadata\.hasPendingWrites/);
  assert.doesNotMatch(statusBridgeSource, /sendNinetyNineFoodOrderStatus/);
  assert.match(frontendSource, /Reconciliar pedidos/);
  assert.match(frontendSource, /segredos da plataforma não são expostos à loja/);
  assert.doesNotMatch(frontendSource, /setBaseUrl|setTokenUrl|URL base da API|URL do token/);
});

test('Firebase Admin is installed as a server dependency', () => {
  const packageJson = JSON.parse(packageSource) as {
    dependencies?: Record<string, string>;
  };
  assert.equal(packageJson.dependencies?.['firebase-admin'], '^14.2.0');
});
