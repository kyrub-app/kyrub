import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shared = readFileSync('shared/aiConsultant.ts', 'utf8');
const client = readFileSync('src/ai/consultantClient.ts', 'utf8');
const multimodal = readFileSync('src/ai/multimodalConsultantClient.ts', 'utf8');
const actionExecute = readFileSync('api/action-execute.ts', 'utf8');
const chatService = readFileSync('server/ai/kyrubiaUserProviderChatService.ts', 'utf8');
const systemInstruction = readFileSync('server/ai/kyrubiaSystemInstruction.ts', 'utf8');

test('text consultant tries BYO-AI through the existing action-execute function before platform inference', () => {
  assert.match(
    shared,
    /KYRUB_AI_CONSULTANT_ENDPOINT\s*=\s*[\s\S]*transport=kyrubia-user-ai-chat/
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

test('cutover reuses action-execute rather than introducing another API function', () => {
  assert.match(actionExecute, /transport === 'kyrubia-user-ai-chat'/);
  assert.match(actionExecute, /kyrubiaUserProviderChatService\.js/);
  assert.match(actionExecute, /executeAuthorizedKyrubiaUserProviderChat/);
});
