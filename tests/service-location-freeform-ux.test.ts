import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('service location configuration is free-form for the merchant', () => {
  const source = readFileSync(
    'src/components/store/ServiceLocationManager.tsx',
    'utf8'
  );

  assert.match(source, /Use os nomes reais do seu negócio; não há categorias obrigatórias/);
  assert.match(source, /placeholder="Ex\.: Salão principal, Mezanino, Calçada, Cadeiras de corte"/);
  assert.match(source, /kind: ServiceLocationKind = 'other'/);
  assert.match(source, /aria-label="Nome do local de atendimento"/);

  assert.doesNotMatch(source, /KIND_OPTIONS/);
  assert.doesNotMatch(source, /<select value=\{newKind\}/);
  assert.doesNotMatch(source, /Mesa 5, Balcão 2, Vaga 3/);
});
