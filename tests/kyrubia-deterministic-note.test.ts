import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveKyrubiaDeterministicNote } from '../shared/kyrubiaDeterministicNote';

test('explicit title and content produce a deterministic note draft', () => {
  const result = resolveKyrubiaDeterministicNote(
    'Crie uma nota chamada Teste de confirmação com o texto: validação do resultado autoritativo'
  );

  assert.ok(result);
  assert.equal(result.noteDraft.title, 'Teste de confirmação');
  assert.equal(result.noteDraft.content, 'validação do resultado autoritativo');
  assert.deepEqual(result.noteDraft.checklist, []);
  assert.match(result.reply, /Revise e confirme/);
});

test('quoted explicit values are preserved without wrapper quotes', () => {
  const result = resolveKyrubiaDeterministicNote(
    'Adicione uma nota intitulada “Fechamento” com o conteúdo: “Conferir o caixa às 18h”'
  );

  assert.ok(result);
  assert.equal(result.noteDraft.title, 'Fechamento');
  assert.equal(result.noteDraft.content, 'Conferir o caixa às 18h');
});

test('creative or underspecified note requests still require generative reasoning', () => {
  assert.equal(
    resolveKyrubiaDeterministicNote(
      'Crie uma receita completa de bolo e salve nas notas desde os ingredientes até servir.'
    ),
    null
  );
  assert.equal(
    resolveKyrubiaDeterministicNote(
      'Crie uma nota para comprar embalagens e inclua um checklist.'
    ),
    null
  );
});

test('consultant client resolves explicit notes before ERP reads, auth token and provider fetch', () => {
  const source = readFileSync(
    new URL('../src/ai/consultantClient.ts', import.meta.url),
    'utf8'
  );

  const resolver = source.indexOf('resolveKyrubiaDeterministicNote(');
  const erpRead = source.indexOf('readKyrubErpContext(currentUser)');
  const token = source.indexOf('currentUser.getIdToken()');
  const network = source.indexOf('fetch(endpoint');

  assert.ok(resolver >= 0);
  assert.ok(resolver < erpRead);
  assert.ok(resolver < token);
  assert.ok(resolver < network);
  assert.match(source, /mode: 'deterministic'/);
  assert.match(source, /type: 'create_note'/);
  assert.match(source, /emitKyrubAiActionProposal/);
});
