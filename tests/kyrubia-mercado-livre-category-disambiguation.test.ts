import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Kyrubia preserves and displays Mercado Livre category ids and hierarchy', () => {
  const prepareTool = readFileSync(
    new URL('../server/ai/kyrubiaMercadoLivrePrepareTool.ts', import.meta.url),
    'utf8'
  );
  const bridge = readFileSync(
    new URL('../server/ai/kyrubiaMercadoLivrePlatformConversation.ts', import.meta.url),
    'utf8'
  );

  assert.match(prepareTool, /categoryPath:\s*suggestion\.categoryPath\.map/);
  assert.match(bridge, /suggestion\.categoryPath/);
  assert.match(bridge, /ID \$\{suggestion\.categoryId\}/);
  assert.match(bridge, /\.join\(' > '\)/);
  assert.match(bridge, /label:\s*categoryChoiceLabel\(suggestion\)/);
  assert.match(bridge, /const context = hierarchy \|\| fallbackContext/);
});
