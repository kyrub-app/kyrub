import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contextPath = new URL('../shared/kyrubiaContext.ts', import.meta.url);
const chatPath = new URL('../server/ai/kyrubiaUserProviderChatService.ts', import.meta.url);
const gatePath = new URL('../server/ai/kyrubiaMercadoLivreListingValidationCommand.ts', import.meta.url);
const commandPath = new URL('../server/ai/kyrubiaMercadoLivrePublicationExecutionCommand.ts', import.meta.url);

test('Cairubia turn context has no Mercado Livre publication bearer capability field', async () => {
  const context = await readFile(contextPath, 'utf8');
  assert.doesNotMatch(context, /KyrubiaMercadoLivrePublicationAuthorizationContinuation/);
  assert.doesNotMatch(context, /mercadoLivrePublicationAuthorization\??:/);
  assert.doesNotMatch(context, /authorizationToken/);
  assert.doesNotMatch(context, /server_issued_one_time_capability/);
});

test('Cairubia chat normalizer never parses or returns legacy publication authorization payloads', async () => {
  const chat = await readFile(chatPath, 'utf8');
  assert.doesNotMatch(chat, /KyrubiaMercadoLivrePublicationAuthorizationContinuation/);
  assert.doesNotMatch(chat, /normalizePublicationAuthorization/);
  assert.doesNotMatch(chat, /raw\.mercadoLivrePublicationAuthorization/);
  assert.doesNotMatch(chat, /authorizationToken/);
  assert.doesNotMatch(chat, /server_issued_one_time_capability/);
});

test('Mercado Livre conversational handlers no longer carry cleanup assignments for a bearer field', async () => {
  const gate = await readFile(gatePath, 'utf8');
  const command = await readFile(commandPath, 'utf8');
  assert.doesNotMatch(gate, /mercadoLivrePublicationAuthorization/);
  assert.doesNotMatch(command, /mercadoLivrePublicationAuthorization/);
  assert.doesNotMatch(gate, /authorizationToken/);
  assert.doesNotMatch(command, /authorizationToken/);
});
