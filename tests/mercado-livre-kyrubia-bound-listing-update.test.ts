import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const commandPath = new URL('../server/ai/kyrubiaMercadoLivreBoundListingUpdateCommand.ts', import.meta.url);
const executionCommandPath = new URL('../server/ai/kyrubiaMercadoLivrePublicationExecutionCommand.ts', import.meta.url);

test('Kyrubia recognizes only an explicit bound listing update preparation command and tolerates terminal punctuation', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /normalizeExplicitCommand/);
  assert.match(source, /replace\(\/\[\.!\?…\]\+\$\/u, ''\)/);
  assert.match(source, /preparar\|prepare/);
  assert.match(source, /atualiza/);
  assert.match(source, /publica/);
  assert.match(source, /requestedBindingId/);
});

test('Kyrubia resolves the current published proposal to its exact binding before preparing an update', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /catalogOutboundPublicationProposals/);
  assert.match(source, /executionStatus !== 'published'/);
  assert.match(source, /externalCatalogBindingId/);
  assert.match(source, /canonicalProductId/);
  assert.match(source, /externalItemId/);
});

test('Kyrubia refuses to guess when more than one published binding is eligible', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /candidates\.length > 1/);
  assert.match(source, /Preparar atualização da publicação ID/);
  assert.match(source, /não escolheu nenhum automaticamente/);
});

test('Kyrubia bound listing update preparation is proposal-only and cannot authorize or write the provider', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /proposeMercadoLivreBoundListingUpdate/);
  assert.match(source, /executionStatus=not_authorized/);
  assert.match(source, /Nenhuma autorização/);
  assert.match(source, /nenhum PUT \/items/);
  assert.doesNotMatch(source, /authorizeMercadoLivreBoundListingUpdate|executeAuthorizedMercadoLivreBoundListingUpdate/);
  assert.doesNotMatch(source, /mercadoLivrePutJson|mercadoLivrePostJson/);
});

test('no-change preparation reports a deterministic no-op without crossing provider write authority', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /proposal\.status === 'no_changes'/);
  assert.match(source, /ficou como no_changes e executionStatus=not_authorized/);
  assert.match(source, /Estoque, categoria, imagem e status da publicação permanecem fora/);
});

test('bound update reply exposes the exact canonical product and price evidence used by the gate', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /produto canônico \$\{proposal\.canonicalProductId\}/);
  assert.match(source, /baseline R\$ \$\{proposal\.baseline\.price\}/);
  assert.match(source, /Kyrub atual R\$ \$\{proposal\.currentCanonical\.price\}/);
  assert.match(source, /Mercado Livre atual R\$ \$\{proposal\.observedExternal\.price\}/);
});

test('existing Mercado Livre operational dispatcher handles the bound update command before publication execution', async () => {
  const source = await readFile(executionCommandPath, 'utf8');
  const boundIndex = source.indexOf('handleKyrubiaMercadoLivreBoundListingUpdateCommand(input)');
  const publishIndex = source.indexOf('const publishNow = isExplicitPublicationExecutionCommand');
  assert.ok(boundIndex >= 0);
  assert.ok(publishIndex > boundIndex);
});
