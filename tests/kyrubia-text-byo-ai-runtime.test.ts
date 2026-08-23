import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const runtime = readFileSync('server/ai/kyrubiaUserProviderRuntime.ts', 'utf8');
const adapters = readFileSync('server/ai/kyrubiaUserProviderAdapters.ts', 'utf8');

test('text BYO-AI runtime resolves the user provider before issuing an inference', () => {
  assert.match(runtime, /resolveUserAiProvider/);
  assert.match(runtime, /await resolveUserAiProvider\(\{ uid: input\.uid \}\)/);
  assert.match(runtime, /callKyrubiaUserProvider/);
});

test('multimodal remains on the legacy route until attachment normalization exists', () => {
  assert.match(runtime, /if \(input\.hasAttachments\)/);
  assert.match(runtime, /reason: 'multimodal_not_normalized'/);
  assert.match(adapters, /multimodalNormalized: false/);
});

test('a configured user provider failure never silently falls through to platform inference', () => {
  assert.match(runtime, /status: 'provider_failed'/);
  assert.match(runtime, /KyrubiaUserProviderAdapterError/);
  assert.doesNotMatch(runtime, /GEMINI_API_KEY|platform_legacy|kyrubia_credits/);
  assert.doesNotMatch(runtime, /catch[\s\S]{0,500}status: 'legacy_allowed'/);
});

test('legacy route is allowed only when there is no user provider or multimodal is not normalized', () => {
  assert.match(runtime, /reason: 'no_user_provider'/);
  assert.match(runtime, /reason: 'multimodal_not_normalized'/);
  assert.doesNotMatch(runtime, /reason: 'provider_failed'/);
});

test('multiple available providers without a persisted preference remain selection-required', () => {
  assert.match(runtime, /resolved\.status === 'selection_required'/);
  assert.match(runtime, /availableProviders: resolved\.availableProviders/);
});

test('runtime defaults use current stable or documented production model ids and remain env-overridable', () => {
  assert.match(runtime, /KYRUBIA_USER_GEMINI_MODEL/);
  assert.match(runtime, /gemini-3\.6-flash/);
  assert.match(runtime, /KYRUBIA_USER_OPENAI_MODEL/);
  assert.match(runtime, /gpt-5\.6/);
  assert.match(runtime, /KYRUBIA_USER_ANTHROPIC_MODEL/);
  assert.match(runtime, /claude-sonnet-5/);
});

test('Gemini-style uppercase schema types are normalized before OpenAI or Anthropic tool use', () => {
  assert.match(runtime, /OBJECT: 'object'/);
  assert.match(runtime, /STRING: 'string'/);
  assert.match(runtime, /ARRAY: 'array'/);
  assert.match(runtime, /normalizeKyrubiaProviderTools/);
});
