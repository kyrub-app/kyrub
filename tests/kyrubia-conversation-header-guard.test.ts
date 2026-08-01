import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Kyrubia keeps the conversation header and exit control reachable', () => {
  const guardSource = readFileSync(
    'src/components/KyrubAiConversationHeaderGuard.tsx',
    'utf8'
  );
  const appSource = readFileSync('src/App.tsx', 'utf8');

  assert.match(guardSource, /Voltar às conversas/);
  assert.match(guardSource, /ACTIVE_CONVERSATION_SELECTOR/);
  assert.match(guardSource, /conversation\.scrollIntoView/);
  assert.match(guardSource, /document\.addEventListener\('scroll', scheduleSync, true\)/);
  assert.match(guardSource, /data-kyrub-ai-fallback-back/);
  assert.match(guardSource, /isHeaderVisible/);
  assert.match(appSource, /<KyrubAiConversationHeaderGuard \/>/);
});
