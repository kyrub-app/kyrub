import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildKyrubHealthPayload,
  type KyrubHealthPayload,
} from '../api/health';

test('production health exposes only safe operational metadata', () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousRelease = process.env.KYRUB_RELEASE;
  const previousEnvironment = process.env.VERCEL_ENV;

  process.env.GEMINI_API_KEY = 'secret-value-that-must-not-leak';
  process.env.KYRUB_RELEASE = 'beta-test';
  process.env.VERCEL_ENV = 'preview';

  try {
    const payload: KyrubHealthPayload = buildKyrubHealthPayload(
      new Date('2026-08-01T12:00:00.000Z')
    );

    assert.equal(payload.status, 'ok');
    assert.equal(payload.service, 'kyrub');
    assert.equal(payload.environment, 'preview');
    assert.equal(payload.release, 'beta-test');
    assert.equal(payload.timestamp, '2026-08-01T12:00:00.000Z');
    assert.equal(payload.capabilities.kyrubia, 'configured');
    assert.doesNotMatch(JSON.stringify(payload), /secret-value/);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;

    if (previousRelease === undefined) delete process.env.KYRUB_RELEASE;
    else process.env.KYRUB_RELEASE = previousRelease;

    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnvironment;
  }
});

test('manual Kyrub remains healthy when Kyrubia is not configured', () => {
  const previousKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  try {
    const payload = buildKyrubHealthPayload(
      new Date('2026-08-01T12:00:00.000Z')
    );
    assert.equal(payload.status, 'ok');
    assert.equal(payload.capabilities.kyrubia, 'unconfigured');
  } finally {
    if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
  }
});

test('Vercel payment and credential runtimes use explicit ESM extensions', () => {
  const runtimeFiles = [
    'api/action-execute.ts',
    'api/admin/operations/health.ts',
    'server/admin/integrationCredentialService.ts',
    'server/admin/integrationReadinessService.ts',
    'server/admin/mercadoLivrePlatformCredentialService.ts',
    'server/payments/paymentIntentRouter.ts',
    'server/payments/mercadoPagoCheckoutBridge.ts',
    'server/payments/mercadoPagoPixProvider.ts',
    'server/payments/mercadoPagoWebhook.ts',
    'server/payments/paymentWebhookProcessor.ts',
    'server/integrations/providerCredentialResolver.ts',
    'server/integrations/platformCredentialStore.ts',
    'server/integrations/kyrubCredentialVault.ts',
    'server/mcp/kyrubiaBridgeSessionService.ts',
    'server/mcp/kyrubiaBridgeServerlessTransport.ts',
    'server/mcp/kyrubiaMcpAuth.ts',
    'server/mcp/kyrubiaMcpChatService.ts',
    'server/mcp/kyrubiaMcpServer.ts',
    'src/utils/paymentOrderMaterialization.ts',
  ];

  for (const file of runtimeFiles) {
    const source = readFileSync(file, 'utf8');
    const relativeSpecifiers = [
      ...Array.from(
        source.matchAll(/\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g),
        match => match[1]
      ),
      ...Array.from(
        source.matchAll(/\bimport\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g),
        match => match[1]
      ),
    ];

    for (const specifier of relativeSpecifiers) {
      assert.match(
        specifier,
        /\.js$/,
        `${file} must use an explicit .js ESM specifier for ${specifier}`
      );
    }
  }
});

test('payment transports do not statically initialize the legacy action graph', () => {
  const source = readFileSync('api/action-execute.ts', 'utf8');

  assert.doesNotMatch(source, /^import\s.+from\s+['"]\.\.\/server\//m);
  assert.match(source, /transport === 'marketplace-payment-intent'/);
  assert.match(source, /transport === 'mercado-pago-webhook'/);
  assert.match(source, /import\('\.\.\/server\/payments\/paymentIntentRouter\.js'\)/);
  assert.match(source, /import\('\.\.\/server\/payments\/mercadoPagoWebhook\.js'\)/);
  assert.match(source, /import\('\.\.\/server\/actions\/actionExecutionFacade\.js'\)/);
});

test('admin integration transports do not statically initialize operations health', () => {
  const source = readFileSync('api/admin/operations/health.ts', 'utf8');

  assert.doesNotMatch(source, /^import\s.+from\s+['"]\.\.\/\.\.\/\.\.\/server\//m);
  assert.match(source, /transport === 'integration-readiness'/);
  assert.match(source, /transport === 'mercado-livre-platform-status'/);
  assert.match(source, /transport === 'mercado-livre-platform-credentials'/);
  assert.match(source, /transport === 'mercado-livre-platform-validate'/);
  assert.match(source, /transport === 'mercado-pago-credentials'/);
  assert.match(source, /transport === 'mercado-pago-test'/);
  assert.match(source, /import\('\.\.\/\.\.\/\.\.\/server\/admin\/integrationReadinessService\.js'\)/);
  assert.match(source, /mercadoLivrePlatformCredentialService\.js/);
  assert.match(source, /import\('\.\.\/\.\.\/\.\.\/server\/admin\/integrationCredentialService\.js'\)/);
  assert.match(source, /import\('\.\.\/\.\.\/\.\.\/server\/admin\/operationsHealthRouter\.js'\)/);
});

test('Mercado Livre platform vault keeps client routes bound to the existing admin serverless runtime', () => {
  const runtime = readFileSync('api/admin/operations/health.ts', 'utf8');
  const client = readFileSync('src/utils/adminMercadoLivrePlatform.ts', 'utf8');

  assert.match(runtime, /mercado-livre-platform-status/);
  assert.match(runtime, /mercado-livre-platform-credentials/);
  assert.match(runtime, /mercado-livre-platform-validate/);
  assert.match(runtime, /mercadoLivrePlatformCredentialService\.js/);
  assert.match(client, /\/api\/admin\/integrations\/mercado-livre/);
  assert.match(client, /\/status/);
  assert.match(client, /\/credentials/);
  assert.match(client, /\/validate/);
});

test('store connections reuse the existing health serverless transport without increasing the function budget', () => {
  const health = readFileSync('api/health.ts', 'utf8');
  const transport = readFileSync('server/integrations/storeConnectionsServerlessTransport.ts', 'utf8');
  const vercel = readFileSync('vercel.json', 'utf8');

  assert.match(vercel, /\/api\/store-connections\/:path\*/);
  assert.match(vercel, /\/api\/health\?transport=store-connections&path=:path\*/);
  assert.match(health, /transport === 'store-connections'/);
  assert.match(health, /storeConnectionsServerlessTransport\.js/);
  assert.match(transport, /createStoreConnectionOnboardingRouter/);
  assert.match(transport, /createMercadoLivreRouter/);
  assert.match(transport, /createMercadoLivreStockExecutionRouter/);
  assert.match(transport, /createMercadoLivreE2ETestRouter/);
  assert.match(transport, /request\.url = `\/api\/store-connections/);
});

test('Kyrubia bridge reuses the health runtime and keeps session lifecycle outside a new serverless function', () => {
  const health = readFileSync('api/health.ts', 'utf8');
  const vercel = readFileSync('vercel.json', 'utf8');
  const transport = readFileSync('server/mcp/kyrubiaBridgeServerlessTransport.ts', 'utf8');

  assert.match(vercel, /\/api\/kyrubia-bridge\/:path\*/);
  assert.match(vercel, /\/api\/health\?transport=kyrubia-bridge&path=:path\*/);
  assert.match(health, /transport === 'kyrubia-bridge'/);
  assert.match(health, /kyrubiaBridgeServerlessTransport\.js/);
  assert.match(transport, /path === 'session'/);
  assert.match(transport, /path === 'session\/status'/);
  assert.match(transport, /path === 'session\/revoke'/);
  assert.match(transport, /authenticateConsultantRequest/);
});

test('Kyrubia bridge credentials are short lived, hashed at rest and revocable', () => {
  const source = readFileSync('server/mcp/kyrubiaBridgeSessionService.ts', 'utf8');

  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /tokenHash/);
  assert.match(source, /MAX_TTL_MINUTES = 24 \* 60/);
  assert.match(source, /expiresAtMillis <= Date\.now\(\)/);
  assert.match(source, /BRIDGE_SESSION_EXPIRED/);
  assert.match(source, /BRIDGE_SESSION_REVOKED/);
  assert.match(source, /mode: 'proposal_only'/);
  assert.doesNotMatch(source, /token:\s*token,[\s\S]*sessionRef\([^)]*\)\.set/);
});

test('MCP accepts bridge sessions without weakening the Firebase-token gate', () => {
  const auth = readFileSync('server/mcp/kyrubiaMcpAuth.ts', 'utf8');

  assert.match(auth, /token\.startsWith\('kbv0\.'\)/);
  assert.match(auth, /verifyKyrubiaBridgeAuthorization/);
  assert.match(auth, /KYRUB_MCP_ALLOW_FIREBASE_ID_TOKEN/);
  assert.match(auth, /verifyFirebaseIdToken/);
  assert.match(auth, /authType: 'firebase_id_token'/);
});

test('MCP exposes direct Kyrubia conversation only in proposal-only read mode', () => {
  const definitions = readFileSync('shared/kyrubiaMcp.ts', 'utf8');
  const server = readFileSync('server/mcp/kyrubiaMcpServer.ts', 'utf8');
  const chat = readFileSync('server/mcp/kyrubiaMcpChatService.ts', 'utf8');

  assert.match(definitions, /name: 'kyrubia_chat'/);
  assert.match(definitions, /readOnlyHint: true/);
  assert.match(server, /KYRUB_MCP_TOOLS/);
  assert.match(server, /callKyrubiaMcpChat/);
  assert.match(chat, /PONTE EXTERNA KYRUBIA — MODO PROPOSAL_ONLY/);
  assert.match(chat, /tools: \[\]/);
  assert.match(chat, /writesAllowed: false/);
  assert.match(chat, /providerWritesAllowed: false/);
  assert.match(chat, /requiresKyrubConfirmation: true/);
  assert.match(chat, /callKyrubMcpReadTool/);
  assert.doesNotMatch(chat, /mercadoLivrePostJson|mercadoLivrePutJson|runTransaction|transaction\.(?:set|update|delete)/);
});

test('Kyrubia operational product reads are terminal, canonical and observable', () => {
  const client = readFileSync('src/ai/consultantClient.ts', 'utf8');
  const health = readFileSync('api/health.ts', 'utf8');
  const transport = readFileSync('server/ai/kyrubiaUserAiChatServerlessTransport.ts', 'utf8');

  assert.match(client, /routeKyrubiaLocalProductIntent/);
  assert.match(client, /localProductReadIntent[\s\S]*\? \[KYRUB_AI_CONSULTANT_ENDPOINT\]/);
  assert.match(client, /!localProductReadIntent &&[\s\S]*hasAnotherEndpoint/);
  assert.match(client, /'x-kyrub-request-id': networkRequestId/);
  assert.match(client, /'x-kyrub-intent': networkIntent/);
  assert.match(client, /OPERATIONAL_DATA_UNAVAILABLE/);

  assert.match(health, /X-Kyrub-Release/);
  assert.match(health, /X-Kyrub-Request-Id/);
  assert.match(health, /kyrubia-user-ai-chat-entry/);
  assert.match(health, /KYRUBIA_USER_AI_CHAT_TRANSPORT_UNAVAILABLE/);

  assert.match(transport, /routeKyrubiaLocalProductIntent\(message\)/);
  assert.match(transport, /decision: 'operational_product_read'/);
  assert.match(transport, /products: mergedProducts/);
  assert.match(transport, /productsTruncated: false/);
  assert.match(transport, /X-Kyrub-Decision/);
  assert.match(transport, /source: 'authoritative_catalog'/);
});