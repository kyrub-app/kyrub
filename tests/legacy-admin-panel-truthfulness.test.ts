import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('legacy admin metrics are derived from received data', () => {
  const source = readFileSync('src/components/AdminPanel.tsx', 'utf8');

  assert.match(source, /orders\.length\.toLocaleString/);
  assert.match(source, /stores\.length\.toLocaleString/);
  assert.match(source, /products\.length\.toLocaleString/);
  assert.match(source, /totalGmvB2B \+ totalGmvB2C/);
  assert.match(source, /Conversão comercial ainda não mensurada/);
  assert.match(source, /Ainda não configurado/);
});

test('legacy admin panel does not invent commercial or infrastructure values', () => {
  const source = readFileSync('src/components/AdminPanel.tsx', 'utf8');

  assert.doesNotMatch(source, /4\.2%/);
  assert.doesNotMatch(source, /R\$ 99/);
  assert.doesNotMatch(source, /10% comissão/i);
  assert.doesNotMatch(source, /Cloudflare Enterprise/i);
  assert.doesNotMatch(source, /Google Cloud Run/i);
  assert.doesNotMatch(source, /Forçar Premium/i);
  assert.doesNotMatch(source, /handleForceUpgrade/);
});
