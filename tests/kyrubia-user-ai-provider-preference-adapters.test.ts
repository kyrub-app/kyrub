import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './kyrubia-user-ai-settings-ui.test';

const preference = readFileSync(
  'server/ai/userAiProviderPreferenceService.ts',
  'utf8'
);
const resolver = readFileSync(
  'server/ai/userAiProviderResolver.ts',
  'utf8'
);
const adapters = readFileSync(
  'server/ai/kyrubiaUserProviderAdapters.ts',
  'utf8'
);

test('provider preference remains server-only and only accepts tested available providers', () => {
  assert.match(preference, /users\/\$\{uid\}\/server_private_ai_config\/routing/);
  assert.match(preference, /credential\.data\(\)\?\.status !== 'available'/);
  assert.match(preference, /AI_PROVIDER_NOT_AVAILABLE/);
  assert.doesNotMatch(preference, /localStorage|sessionStorage|firebase\/firestore/);
});

test('resolver consumes persisted preference only when no explicit override was supplied', () => {
  assert.match(resolver, /loadUserAiProviderPreference/);
  assert.match(resolver, /input\.preferredProvider === undefined/);
  assert.match(resolver, /await loadUserAiProviderPreference\(uid\)/);
  assert.match(resolver, /preferredProvider,/);
});

test('provider adapters expose one normalized text and tools contract without hidden default models', () => {
  assert.match(adapters, /KyrubiaProviderRequest/);
  assert.match(adapters, /KyrubiaProviderResponse/);
  assert.match(adapters, /type: 'tool_call'/);
  assert.match(adapters, /type: 'tool_result'/);
  assert.match(adapters, /multimodalNormalized: false/);
  assert.doesNotMatch(adapters, /gemini-[0-9]|gpt-[0-9]|claude-[a-z]+-[0-9]/i);
});

test('Gemini OpenAI and Anthropic adapters use current provider API families and keep keys in headers', () => {
  assert.match(adapters, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(adapters, /'x-goog-api-key': input\.apiKey/);
  assert.match(adapters, /api\.openai\.com\/v1\/responses/);
  assert.match(adapters, /authorization: `Bearer \$\{input\.apiKey\}`/);
  assert.match(adapters, /api\.anthropic\.com\/v1\/messages/);
  assert.match(adapters, /'x-api-key': input\.apiKey/);
  assert.doesNotMatch(adapters, /\?key=\$\{input\.apiKey\}/);
});

test('provider adapters normalize tool calls and token usage without logging payloads or secrets', () => {
  assert.match(adapters, /functionCall/);
  assert.match(adapters, /type: 'function_call'/);
  assert.match(adapters, /type: 'tool_use'/);
  assert.match(adapters, /inputTokens/);
  assert.match(adapters, /outputTokens/);
  assert.doesNotMatch(adapters, /console\.(?:log|warn|error)\([^\n]*payload/);
  assert.doesNotMatch(adapters, /console\.(?:log|warn|error)\([^\n]*apiKey/);
});
