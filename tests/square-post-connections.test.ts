import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { Friend } from '../src/types';
import { resolvePostAuthorConnection } from '../src/utils/socialPostConnections';
import type { CommunityPostConnection } from '../src/utils/communityPostConnections';

const viewer = 'account-kyrub';
const author = 'account-mauricio';
const post = { authorId: author, user: 'Maurício Francisco', avatar: '' };
const accepted: CommunityPostConnection = {
  id: 'account-kyrub_account-mauricio',
  senderId: author, receiverId: viewer,
  status: 'accepted',
};
const friend: Friend = {
  id: author, name: 'Maurício Francisco', role: 'Cliente',
  avatar: '', added: true, connectionStatus: 'accepted',
  connectionId: accepted.id,
};

test('accepted Firestore connection enables Conversar even when local friends are not yet populated', () => {
  const result = resolvePostAuthorConnection(viewer, post, [], [accepted]);
  assert.equal(result.status, 'accepted');
  assert.equal(result.friend?.id, author);
  assert.equal(result.friend?.connectionStatus, 'accepted');
  assert.equal(result.friend?.connectionId, accepted.id);
  assert.equal(result.friend?.name, 'Maurício Francisco');
  assert.equal(result.friend?.added, true);
});

test('accepted connection from canonical Conectados uses same Friend payload while subscription loads', () => {
  const result = resolvePostAuthorConnection(viewer, post, [friend], []);
  assert.equal(result.status, 'accepted');
  assert.equal(result.friend?.connectionId, accepted.id);
  assert.equal(result.friend?.id, author);
  assert.equal(resolvePostAuthorConnection(viewer, post, [friend], [accepted]).status, 'accepted');
});

test('pending request never grants a chat even with a stale local contact', () => {
  for (const sender of [viewer, author]) {
    const pending = { ...accepted, senderId: sender,
      receiverId: sender === viewer ? author : viewer, status: 'pending' as const };
    const relation = resolvePostAuthorConnection(viewer, post, [friend], [pending]);
    assert.equal(relation.status, sender === viewer ? 'pending_sent' : 'pending_received');
    assert.equal(relation.friend, null);
  }
});

test('self, unrelated contacts and name-only matches do not grant conversation access', () => {
  const other: Friend = { ...friend, id: 'unrelated', name: post.user };
  assert.equal(resolvePostAuthorConnection(viewer, post, [other], []).friend, null);
  assert.equal(resolvePostAuthorConnection(viewer, { ...post, authorId: viewer }, [friend], [accepted]).friend, null);
  assert.equal(resolvePostAuthorConnection(viewer, { ...post, authorId: undefined }, [friend], []).friend, null);
  const fake = { ...accepted, senderId: viewer, receiverId: 'other-user' };
  assert.equal(resolvePostAuthorConnection(viewer, post, [], [fake]).friend, null);
});

test('both actual Praça surfaces get canonical connection and chat opening from the same authenticated contact', () => {
  const publicFeed = readFileSync('src/components/PublicSocialFeedPanel.tsx', 'utf8');
  const native = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');
  const chat = readFileSync('src/components/modals/ChatModal.tsx', 'utf8');

  assert.match(publicFeed, /resolvePostAuthorConnection\(\s*currentUserId, post, friends, communityConnections/);
  assert.match(publicFeed, /onOpenChat\(connectedAuthor\)/);
  assert.match(publicFeed, /authorConnection\.status === 'none' && suggestedAuthor/);
  assert.match(native, /resolvePostAuthorConnection\(currentUserId, post, friends, connections\)/);
  assert.match(native, /authorConnection\.status === 'accepted' && authorConnection\.friend/);
  assert.match(native, /onOpenChat\(authorConnection\.friend!\)/);
  assert.match(native, /friends=\{directory\.friends\}/);
  assert.match(native, /connections=\{squareConnections\}/);
  assert.match(native, /setChatTarget\(friend\)/);
  assert.match(chat, /selectedChatUser\.connectionStatus === 'accepted'/);
  assert.match(chat, /selectedChatUser\.connectionId/);
});

test('Semear uses a reddish seed and native personal posts use canonical Semear when enabled', () => {
  const button = readFileSync('src/components/SemearButton.tsx', 'utf8');
  const native = readFileSync('src/components/ProfileSocialHubNative.tsx', 'utf8');
  assert.match(button, /state\?\.closed \? '🌲' : '🫘'/);
  assert.match(native, /SEMEADURA_UI_ENABLED && post\.visibility === 'public' && post\.publicationType !== 'status'/);
  assert.match(native, /<SemearButton kind="personal" postId=\{post\.id\} viewerId=\{currentUserId\}/);
  assert.match(native, /onClick=\{onToggleLike\}/); // Existing non-eligible posts remain unchanged.
});
