import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './kyrubia-user-ai-provider-resolver.test';
import './kyrubia-user-ai-provider-preference-adapters.test';

const service = readFileSync(
  'server/ai/userAiProviderCredentialService.ts',
  'utf8'
);
const actionExecute = readFileSync('api/action-execute.ts', 'utf8');
const firestoreRules = readFileSync('firestore.rules', 'utf8');

test('user AI credentials live in a server-only namespace and are bound to uid plus provider', () => {
  assert.match(service, /users\/\$\{uid\}\/server_private_ai\/\$\{provider\}/);
  assert.match(service, /kyrubia-ai-provider:\$\{uid\}:\$\{provider\}/);
  assert.match(service, /encryptIntegrationSecret/);
  assert.match(service, /decryptIntegrationSecret/);
  assert.match(service, /getIntegrationMasterKey/);
  assert.doesNotMatch(firestoreRules, /match \/server_private_ai\//);
  assert.match(firestoreRules, /match \/\{document=\*\*\} \{\s*allow read, write: if false;/);
});

test('browser-facing metadata never returns the full provider secret', () => {
  assert.match(service, /maskedCredential/);
  assert.match(service, /fingerprint/);
  assert.match(service, /configured: true/);
  assert.match(service, /status: 'not_configured'/);
  assert.doesNotMatch(
    service,
    /return \{\s*provider,\s*configured: true,[\s\S]{0,300}apiKey/
  );
});

test('provider only becomes available after a server-side connection test', () => {
  assert.match(service, /status: 'saved'/);
  assert.match(service, /await verifyProviderCredential/);
  assert.match(service, /status: 'available'/);
  assert.match(service, /AI_PROVIDER_CREDENTIAL_REJECTED/);
  assert.match(service, /AI_PROVIDER_LIMIT_REACHED/);
  assert.match(service, /error\.code === 'AI_PROVIDER_CREDENTIAL_REJECTED'/);
  assert.doesNotMatch(
    service,
    /error\.code === 'AI_PROVIDER_LIMIT_REACHED'[\s\S]{0,180}status: 'invalid'/
  );
});

test('Gemini OpenAI and Anthropic connection checks keep credentials in headers', () => {
  assert.match(service, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(service, /'x-goog-api-key': apiKey/);
  assert.match(service, /api\.openai\.com\/v1\/models/);
  assert.match(service, /authorization: `Bearer \$\{apiKey\}`/);
  assert.match(service, /api\.anthropic\.com\/v1\/models/);
  assert.match(service, /'x-api-key': apiKey/);
  assert.match(service, /'anthropic-version': '2023-06-01'/);
  assert.doesNotMatch(service, /\?key=\$\{apiKey\}/);
});

test('user AI provider vault reuses action-execute without adding a Vercel function', () => {
  assert.match(actionExecute, /transport === 'kyrubia-user-ai-provider'/);
  assert.match(
    actionExecute,
    /import\('\.\.\/server\/ai\/userAiProviderCredentialService\.js'\)/
  );
  assert.match(actionExecute, /operation === 'list'/);
  assert.match(actionExecute, /operation === 'save'/);
  assert.match(actionExecute, /operation === 'test'/);
  assert.match(actionExecute, /operation === 'delete'/);
});
