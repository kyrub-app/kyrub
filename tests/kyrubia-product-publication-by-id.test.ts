import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseKyrubProductPublicationIntent } from '../shared/kyrubProductPublicationIntent';

test('product publication intent accepts an exact canonical product ID', () => {
  const productId = 'product-0d775760ee92ea565b977865e16aada6';
  assert.deepEqual(
    parseKyrubProductPublicationIntent(`Despublique o produto ID ${productId}`),
    {
      productName: '',
      productId,
      published: false,
    }
  );
});

test('product publication intent keeps existing name commands unchanged', () => {
  assert.deepEqual(
    parseKyrubProductPublicationIntent('Despublique o produto “Squeeze 480ml Dobrável Laranja com Mosquetão”'),
    {
      productName: 'Squeeze 480ml Dobrável Laranja com Mosquetão',
      published: false,
    }
  );
});

test('explicit product IDs fail closed when malformed or too long', () => {
  assert.equal(
    parseKyrubProductPublicationIntent('Despublique o produto ID product-invalid/path'),
    null
  );
  assert.equal(
    parseKyrubProductPublicationIntent(`Despublique o produto ID product-${'a'.repeat(130)}`),
    null
  );
});

test('publication runtime resolves exact IDs before proposing the reversible lifecycle action', async () => {
  const source = await readFile(
    new URL('../src/ai/productPublicationRuntime.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /draft\.id === targetProductId/);
  assert.match(source, /product\.id === targetProductId/);
  assert.match(source, /proposalFor\(product\.id, product\.name, false\)/);
  assert.match(source, /requiresConfirmation: true/);
});
