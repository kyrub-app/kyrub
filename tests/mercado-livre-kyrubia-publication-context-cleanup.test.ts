import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isGenericMercadoLivreExternalWriteConfirmation,
  resolveKyrubiaMercadoLivreGenericConfirmationGuard,
} from '../server/ai/kyrubiaMercadoLivreGenericConfirmationGuard.js';

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

test('generic confirmations never authorize a pending Mercado Livre external write', () => {
  for (const message of ['Sim', 'ok', 'pode', 'Confirmo', 'Autorizo']) {
    assert.equal(isGenericMercadoLivreExternalWriteConfirmation(message), true);
    const result = resolveKyrubiaMercadoLivreGenericConfirmationGuard({
      messages: [{ role: 'user', content: message }],
      turnContext: {
        version: 1,
        id: 'ml-bound-update-review-test',
        source: 'kyrub_runtime',
        sourceAction: 'mercado_livre_publication_preparation',
        generatedAt: new Date().toISOString(),
        scope: { kind: 'own_store', storeId: 'owner-test' },
        entities: [{
          entityType: 'product',
          entityId: 'product-test',
          label: 'Produto teste',
          position: 1,
        }],
      },
    });
    assert.equal(result?.blocked, true);
    assert.match(result?.reply ?? '', /não autoriza nenhuma escrita externa/i);
    assert.match(result?.reply ?? '', /Nenhuma autorização foi criada/i);
    assert.match(result?.reply ?? '', /nenhum POST ou PUT \/items foi enviado/i);
  }
});

test('explicit bound-update authorization is not swallowed by the generic confirmation guard', () => {
  const explicit = 'Autorizo a proposta mlupd_a8a8d0047acaba11484d064d3e059f6a para o item MLB7640119796: alterar exclusivamente o preço de R$ 22,00 para R$ 23,00.';
  assert.equal(isGenericMercadoLivreExternalWriteConfirmation(explicit), false);
  const result = resolveKyrubiaMercadoLivreGenericConfirmationGuard({
    messages: [{ role: 'user', content: explicit }],
    turnContext: {
      version: 1,
      id: 'ml-bound-update-review-test',
      source: 'kyrub_runtime',
      sourceAction: 'mercado_livre_publication_preparation',
      generatedAt: new Date().toISOString(),
      scope: { kind: 'own_store', storeId: 'owner-test' },
      entities: [{ entityType: 'product', entityId: 'product-test', label: 'Produto teste', position: 1 }],
    },
  });
  assert.equal(result, null);
});

test('structured Mercado Livre option turns are not blocked as generic confirmations', () => {
  const result = resolveKyrubiaMercadoLivreGenericConfirmationGuard({
    messages: [{ role: 'user', content: 'Sim' }],
    turnContext: {
      version: 1,
      id: 'ml-category-turn-test',
      source: 'kyrub_runtime',
      sourceAction: 'mercado_livre_publication_preparation',
      generatedAt: new Date().toISOString(),
      scope: { kind: 'own_store', storeId: 'owner-test' },
      entities: [{ entityType: 'product', entityId: 'product-test', label: 'Produto teste', position: 1 }],
      offeredIntents: [{ id: 'choice-1' }],
    },
  });
  assert.equal(result, null);
});
