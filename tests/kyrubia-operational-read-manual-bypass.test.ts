import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldDeferTrustedReadToOperationalWorkflow } from '../src/ai/objectiveRuntimeService';
import { resolveKyrubiaTrustedReadRuntime } from '../src/ai/trustedReadRuntime';
import type { KyrubActivityStorage } from '../src/observability/kyrubActivityLog';

const storage: KyrubActivityStorage = {
  getItem: () => null,
  setItem: () => undefined,
};

const failingProductionPhrase =
  'Quais são os produtos da minha loja cadastrados na categoria “chaveiro”?';

test('operational product category read defers before Manual KYRUB routing', () => {
  assert.equal(
    shouldDeferTrustedReadToOperationalWorkflow(failingProductionPhrase),
    true
  );
});

test('trusted knowledge cannot answer an operational product category read', () => {
  assert.equal(
    resolveKyrubiaTrustedReadRuntime(
      storage,
      'test-user',
      failingProductionPhrase
    ),
    null
  );
});

test('straight quotes keep the same operational routing', () => {
  assert.equal(
    shouldDeferTrustedReadToOperationalWorkflow(
      'Quais são os produtos da minha loja cadastrados na categoria "chaveiro"?'
    ),
    true
  );
});

test('existing catalog mutation deferral remains enabled', () => {
  assert.equal(
    shouldDeferTrustedReadToOperationalWorkflow(
      'Quero atualizar o produto Chaveiro NFC da minha loja.'
    ),
    true
  );
});

test('a genuine Kyrub product question remains eligible for trusted knowledge', () => {
  assert.equal(
    shouldDeferTrustedReadToOperationalWorkflow('O que é Kyrub?'),
    false
  );

  const result = resolveKyrubiaTrustedReadRuntime(
    storage,
    'test-user',
    'O que é Kyrub?'
  );
  assert.ok(result);
  assert.equal(result.kind, 'official_uncertain');
  assert.match(result.reply, /Manual KYRUB/);
});
