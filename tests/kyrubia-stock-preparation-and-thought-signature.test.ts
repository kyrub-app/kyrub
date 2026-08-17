import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('stock preparation question is intercepted deterministically before Gemini fallback', async () => {
  const source = await readFile(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /const stockPreparationResponse =/);
  assert.match(source, /kyrub-stock-preparation-runtime-v1/);
  assert.match(source, /estoque 0/);
  assert.match(source, /ficha técnica/);

  const handlerGuard = source.indexOf(
    'const deterministicStockPreparation = stockPreparationResponse(body, messages);'
  );
  const genericFallback = source.indexOf(
    'await runGenericWithCapabilityGuard(request, response, body, decision);'
  );
  assert.ok(handlerGuard >= 0, 'stock preparation guard must exist');
  assert.ok(genericFallback >= 0, 'generic Gemini fallback must exist');
  assert.ok(
    handlerGuard < genericFallback,
    'stock preparation must be resolved before the generic Gemini fallback'
  );
});

test('Gemini ERP tool follow-up preserves the original function-call Part and thought signature metadata', async () => {
  const source = await readFile(
    new URL('../api/kyrubia.ts', import.meta.url),
    'utf8'
  );

  assert.match(source, /part: Record<string, unknown>/);
  assert.match(source, /part: rawPart/);
  assert.match(source, /parts: \[readCall\.part\]/);
  assert.doesNotMatch(
    source,
    /parts:\s*\[\{\s*functionCall:\s*\{\s*id:\s*readCall\.id,[\s\S]{0,180}args:\s*readCall\.args/
  );
});
