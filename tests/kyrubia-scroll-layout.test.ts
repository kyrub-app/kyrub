import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Kyrubia conversation keeps controls visible while messages scroll', () => {
  const source = readFileSync('src/components/AppModalLayoutBridge.tsx', 'utf8');

  assert.match(source, /#kyrub-ai-workspace > section/);
  assert.match(source, /data-kyrub-ai-conversation/);
  assert.match(source, /--kyrub-ai-conversation-height/);
  assert.match(source, /\[data-kyrub-ai-conversation="true"\] > header/);
  assert.match(source, /\[data-kyrub-ai-conversation="true"\] > form/);
  assert.match(source, /\[data-kyrub-ai-conversation="true"\] > div/);
  assert.match(source, /overflow-y: auto !important/);
  assert.match(source, /min-height: 0 !important/);
});

test('Kyrubia note proposal scrolls between a fixed header and footer', () => {
  const source = readFileSync('src/components/AppModalLayoutBridge.tsx', 'utf8');

  assert.match(source, /isKyrubAiNotePanel/);
  assert.match(source, /data-kyrub-ai-note-overlay/);
  assert.match(source, /data-kyrub-ai-note-panel/);
  assert.match(source, /\[data-kyrub-ai-note-panel="true"\] > header/);
  assert.match(source, /\[data-kyrub-ai-note-panel="true"\] > footer/);
  assert.match(source, /\[data-kyrub-ai-note-panel="true"\] > div/);
  assert.match(source, /overscroll-behavior: contain !important/);
  assert.match(source, /-webkit-overflow-scrolling: touch/);
});
