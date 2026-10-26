import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');
const start = native.indexOf('function ContactCard(');
const end = native.indexOf('export function ProfileSocialHubNative()', start);
const card = native.slice(start, end);

test('connected card owns native image containment and background', () => {
  assert.match(card, /data-profile-connected-friend-id=\{friend\.id\}/);
  assert.match(card, /object-contain/);
  assert.match(card, /backgroundImage: mediaBackground/);
  assert.match(card, /blur-xl/);
  assert.match(card, /bg-gradient-to-b/);
  assert.match(card, /onClick=\{onFavorite\}/);
  assert.match(card, /onClick=\{onChat\}/);
  assert.match(card, /onClick=\{onRemove\}/);
});
