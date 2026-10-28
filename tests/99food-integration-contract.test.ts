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

test('duplicate webhook events are reserved atomically and only acknowledged after processing', () => {
  const reserveStart = serviceSource.indexOf('const reserveEvent = async');
  const processStart = serviceSource.indexOf('export const processNinetyNineFoodEvent', reserveStart);
  const pollStart = serviceSource.indexOf('export const pollNinetyNineFood', processStart);
  assert.ok(reserveStart >= 0 && processStart > reserveStart && pollStart > processStart);
  const reserve = serviceSource.slice(reserveStart, processStart);
  const process = serviceSource.slice(processStart, pollStart);
  assert.match(reserve, /runTransaction\(async transaction =>/);
  assert.match(reserve, /status === 'processed' \|\| \(status === 'processing' && leaseActive\)/);
  assert.match(reserve, /return false/);
  assert.match(process, /if \(!reservation\.reserved\) return \{ duplicate: true, event \}/);
  assert.match(process, /finalizeReservedEvent\(/);
  const finalizer = serviceSource.slice(serviceSource.indexOf('const finalizeReservedEvent = async'), processStart);
  assert.match(finalizer, /status: 'processed'/);
  assert.match(finalizer, /status: 'failed'/);
  const polling = serviceSource.slice(pollStart);
  assert.match(polling, /acknowledged\.push\(event\)/);
  assert.match(polling, /acknowledgeEvents\(acknowledged\)/);
});

test('expired event workers cannot finalize a reservation claimed by another attempt', () => {
  assert.match(serviceSource, /const attemptId = randomBytes\(16\)\.toString\('hex'\)/);
  assert.match(serviceSource, /attemptId,\s*attempts: FieldValue\.increment\(1\)/);
  assert.match(serviceSource, /data\.attemptId !== attemptId/);
  assert.match(serviceSource, /lease\.toMillis\(\) <= Date\.now\(\)\) return false/);
  assert.match(serviceSource, /finalizeReservedEvent\(\s*reservation\.referencePath, reservation\.attemptId, 'processed'/);
  assert.match(serviceSource, /finalizeReservedEvent\(reservation\.referencePath, reservation\.attemptId, 'failed', message\)/);
  assert.match(serviceSource, /NINETY_NINE_FOOD_EVENT_RESERVATION_LOST/);
});

test('first order creation and existing order updates both require the active event lease', () => {
  const creationStart = serviceSource.indexOf('const persistNormalizedOrder = async');
  const creationEnd = serviceSource.indexOf('const updatePersistedOrderStatus', creationStart);
  const creation = serviceSource.slice(creationStart, creationEnd);
  assert.match(creation, /transaction\.get\(eventReference\)/);
  assert.match(creation, /reserved\?\.attemptId !== eventAttemptId/);
  assert.match(creation, /lease\.toMillis\(\) <= Date\.now\(\)/);
  assert.match(creation, /transaction\.create\(reference/);
  const inboundSource = readFileSync('server/inventory/ninetyNineFoodInboundStatusAuthorityService.ts', 'utf8');
  assert.match(inboundSource, /transaction\.get\(adminDb\.doc\(eventReferencePath\)\)/);
  assert.match(inboundSource, /clean\(reservedEvent\.attemptId\) !== eventAttemptId/);
  assert.match(serviceSource, /reservation\.attemptId, event\.eventId, event\.orderId/);
});

test('first import rejects mismatched provider order details before writing', () => {
  const handler = serviceSource.slice(
    serviceSource.indexOf('export const processNinetyNineFoodEvent'),
    serviceSource.indexOf('export const receiveNinetyNineFoodWebhook')
  );
  const initial = handler.slice(handler.indexOf('if (!currentOrder.exists)'), handler.indexOf('} else {'));
  assert.match(initial, /order\.integration\.externalOrderId !== event\.orderId/);
  assert.ok(initial.indexOf('NINETY_NINE_FOOD_PAYMENT_ORDER_MISMATCH') <
    initial.indexOf('await persistNormalizedOrder('));
});

test('retry after first order persistence reuses canonical identity instead of creating a duplicate', () => {
  const handler = serviceSource.slice(
    serviceSource.indexOf('export const processNinetyNineFoodEvent'),
    serviceSource.indexOf('export const receiveNinetyNineFoodWebhook')
  );
  assert.match(handler, /stores\/\$\{canonicalStoreId\}\/orders\/\$\{internalOrderId\(event\.orderId\)\}/);
  assert.match(handler, /if \(!currentOrder\.exists\) \{/);
  assert.match(handler, /await persistNormalizedOrder\(/);
  assert.match(handler, /await applyNinetyNineFoodInboundStatusWithAuthority\(/);
  const persist = serviceSource.slice(
    serviceSource.indexOf('const persistNormalizedOrder = async'),
    serviceSource.indexOf('const updatePersistedOrderStatus')
  );
  assert.match(persist, /if \(existing\.exists\) return;/);
  assert.match(persist, /transaction\.create\(reference/);
  assert.match(handler, /if \(!finalized\) \{/);
  assert.match(handler, /NINETY_NINE_FOOD_EVENT_RESERVATION_LOST/);
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

test('real orders use the canonical store order collection and KDS routing', () => {
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
