import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const collectorPath = new URL(
  '../server/ai/kyrubiaMercadoLivreRequiredAttributeCollector.ts',
  import.meta.url
);

test('Kyrubia strips attribute labels before accepting open text values', async () => {
  const source = await readFile(collectorPath, 'utf8');
  assert.match(source, /const attributeAnswerText =/);
  assert.match(source, /for \(const label of \[attribute\.name, attribute\.id\]\)/);
  assert.match(source, /const text = attributeAnswerText\(attribute, rawText\)/);
  assert.match(source, /attributeHasClosedProviderValueSet\(attribute\)/);
  assert.match(source, /return \{ id: attribute\.id, name: attribute\.name, valueName: text \}/);
});

test('open values are distinct from closed list and boolean values', async () => {
  const source = await readFile(collectorPath, 'utf8');
  assert.match(source, /attribute\.valueType === 'list' \|\| attribute\.valueType === 'boolean'/);
  assert.match(source, /Esses valores são sugestões, não uma lista fechada/);
  assert.match(source, /Valores oficiais permitidos/);
});
