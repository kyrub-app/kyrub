import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/components/KyrubClubePanel.tsx', import.meta.url), 'utf8');

test('Kyrub Clube experience exposes all official battery sections', () => {
  for (const label of ['K-Coins', 'XP', 'Nível', 'Desafios', 'Conquistas', 'Histórico', 'Recompensas']) {
    assert.match(source, new RegExp(label));
  }
});

test('Kyrub Clube keeps K-Coins and XP visually distinct', () => {
  assert.match(source, /K-Coins, XP, nível, desafios, conquistas e recompensas em economias separadas/);
  assert.doesNotMatch(source, /1\s*K-Coin\s*=\s*R\$/);
});
