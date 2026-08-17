import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('storefront does not confuse untracked zero stock with sold out', () => {
  const source = readFileSync('src/components/pdv/SharedPdvCatalog.tsx', 'utf8');
  assert.match(source, /stockTracked\?: boolean/);
  assert.match(source, /stockTracked === true/);
  assert.match(source, /Estoque não informado/);
  assert.doesNotMatch(
    source,
    /const isUnavailable = !product\.isService && product\.stock <= 0;/
  );
});
