import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const native = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');
const bridge = readFileSync('src/components/ProfileConnectedCardsPolishBridge.tsx', 'utf8');

test('connected card carries its real friend UID into bridge actions', () => {
  assert.match(native, /data-profile-connected-friend-id=\{friend\.id\}/);
  assert.equal((bridge.match(/card\.dataset\.profileConnectedFriendId/g) ?? []).length, 2);
  assert.match(bridge, /users\.find\(user => user\.id === canonicalFriendId\)/);
  assert.match(bridge, /latestStatusByAuthor\.byId\.get\(canonicalFriendId\)/);
  assert.match(bridge, /const friendId = canonicalFriendId \|\| profile\?\.id \|\| ''/);
});
