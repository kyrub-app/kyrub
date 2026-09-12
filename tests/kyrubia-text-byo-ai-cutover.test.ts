import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shared = readFileSync('shared/aiConsultant.ts', 'utf8');
const client = readFileSync('src/ai/consultantClient.ts', 'utf8');
const multimodal = readFileSync('src/ai/multimodalConsultantClient.ts', 'utf8');
const health = readFileSync('api/health.ts', 'utf8');
const actionExecute = readFileSync('api/action-execute.ts', 'utf8');
const chatTransport = readFileSync('server/ai/kyrubiaUserAiChatServerlessTransport.ts', 'utf8');
const chatService = readFileSync('server/ai/kyrubiaUserProviderChatService.ts', 'utf8');
const systemInstruction = readFileSync('server/ai/kyrubiaSystemInstruction.ts', 'utf8');

test('text consultant reaches the dedicated Kyrubia chat transport before platform inference', () => {
  assert.match(
    shared,
    /KYRUB_AI_CONSULTANT_ENDPOINT\s*=\s*[\s\S]*\/api\/health\?transport=kyrubia-user-ai-chat/
  );
  assert.match(shared, /KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT = KYRUB_AI_PLATFORM_CONSULTANT_ENDPOINT/);
  assert.match(client, /const CONSULTANT_ENDPOINTS = \[/);
  assert.match(client, /KYRUB_AI_CONSULTANT_ENDPOINT,[\s\S]*KYRUB_AI_CONSULTANT_COMPAT_ENDPOINT/);
});

test('multimodal bypasses BYO-AI until attachment normalization exists', () => {
  assert.match(multimodal, /KYRUB_AI_PLATFORM_CONSULTANT_ENDPOINT/);
  assert.match(multimodal, /fetch\(KYRUB_AI_PLATFORM_CONSULTANT_ENDPOINT/);
  assert.doesNotMatch(multimodal, /transport=kyrubia-user-ai-chat/);
});

test('legacy continuation is explicit while provider errors with Kyrub codes stop compatibility fallback', () => {
  assert.match(chatService, /httpStatus: 404/);
  assert.match(chatService, /status: 'legacy_allowed'/);
  assert.match(client, /response\.status === 404/);
  assert.match(client, /!hasTopLevelKyrubCode\(body\)/);
  assert.match(chatService, /status: 'provider_failed'/);
  assert.match(chatService, /code: result\.code/);
});

test('BYO-AI chat derives identity and request id on the server and builds the system instruction server-side', () => {
  assert.match(chatService, /authenticateConsultantRequest\(authorization\)/);
  assert.match(chatService, /const requestId = randomUUID\(\)/);
  assert.match(chatService, /buildKyrubiaSystemInstruction\(user, topic, screenContext\)/);
  assert.doesNotMatch(chatService, /raw\.uid|raw\.systemText|raw\.requestId/);
  assert.match(systemInstruction, /Você é Kyrubia, a inteligência artificial de Kyrub/);
});

test('BYO-AI success is explicitly user-funded and does not debit Kyrubia Credits', () => {
  assert.match(chatService, /funding: 'user_provider'/);
  assert.match(chatService, /capabilities: byoCapabilities/);
  assert.doesNotMatch(chatService, /debit|charge.*credit|kyrubia_credits/i);
});

test('health transport owns the deterministic chat interception before provider delegation', () => {
  assert.match(health, /transport === 'kyrubia-user-ai-chat'/);
  assert.match(health, /kyrubiaUserAiChatServerlessTransport\.js/);
  assert.match(health, /handleKyrubiaUserAiChatServerlessRequest/);
});

test('legacy action-execute chat transport uses the same deterministic authority', () => {
  assert.match(actionExecute, /transport === 'kyrubia-user-ai-chat'/);
  assert.match(actionExecute, /kyrubiaUserAiChatServerlessTransport\.js/);
  assert.match(actionExecute, /handleKyrubiaUserAiChatServerlessRequest\(request, response\)/);
  assert.doesNotMatch(
    actionExecute,
    /transport === 'kyrubia-user-ai-chat'[\s\S]{0,500}kyrubiaUserProviderChatService\.js/
  );
});

test('operational product transport can recover from transient auth failure with the authenticated client ERP snapshot', () => {
  assert.match(chatTransport, /clientCatalogContext/);
  assert.match(chatTransport, /body\.erpContext/);
  assert.match(chatTransport, /isTransientAuthUnavailable/);
  assert.match(chatTransport, /resolveClientCatalogRead\(message, input, traceId\)/);
});

test('category transport resolves the canonical store mapping recorded on the legacy tenant first', () => {
  assert.match(chatTransport, /canonicalStoreId: cleanText\(data\.canonicalStoreId, 160\)/);
  assert.match(chatTransport, /if \(!canonicalStoreId\)[\s\S]*findCanonicalStoreForOwner\(uid\)/);
  assert.match(chatTransport, /stores\/\$\{storeId\}\/products/);
});

test('provider service is lazy-loaded only after deterministic operational handling', () => {
  assert.doesNotMatch(chatTransport, /^import .*kyrubiaUserProviderChatService\.js/m);
  assert.match(chatTransport, /const deterministic = await deterministicOperationalRead/);
  assert.match(chatTransport, /await import\('\.\/kyrubiaUserProviderChatService\.js'\)/);
});
