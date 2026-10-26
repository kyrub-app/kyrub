import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const main = readFileSync('src/main.tsx', 'utf8');
const cards = readFileSync('src/components/ProfileConnectedCardsPolishBridge.tsx', 'utf8');

test('connected image fit is owned by cards without a second polling bridge', () => {
  assert.doesNotMatch(main, /ProfileConnectedImageFitBridge/);
  assert.match(cards, /data-profile-connected-media/);
  assert.match(cards, /--profile-connected-image/);
  assert.match(cards, /background-image: var\(--profile-connected-image\)/);
  assert.match(cards, /object-fit: contain !important/);
  assert.match(cards, /filter: blur\(20px\)/);
  assert.match(cards, /media\.style\.removeProperty\('--profile-connected-image'\)/);
});
