import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('catalog continuation forwarding preserves Vercel request headers explicitly', () => {
  const router = readFileSync(
    new URL('../api/consultor-kyrub.ts', import.meta.url),
    'utf8'
  );

  assert.match(router, /const withRequestBody/);
  assert.match(router, /method: request\.method/);
  assert.match(router, /headers: request\.headers/);
  assert.match(
    router,
    /withRequestBody\(request, withCatalogAnalysisContext\(body, analysisContext\)\)/
  );
  assert.doesNotMatch(
    router,
    /\? \{ \.\.\.request, body: withCatalogAnalysisContext\(body, analysisContext\) \}/
  );
});
