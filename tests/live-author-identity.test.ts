import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { displayAuthorAvatar, displayAuthorName } from '../src/utils/authorDisplayIdentity';

const read = (path: string) => readFileSync(path, 'utf8');

test('old community post and forward both display the renamed author by stable UID', () => {
  const authorId = 'user-profile-123';
  const savedPost = Object.freeze({
    id: 'original-post-1',
    authorId,
    authorName: 'Mauricio Francisco',
    authorAvatar: 'https://old.example/avatar.png',
    content: 'Texto publicado anteriormente',
    createdAt: '2026-11-19T09:18:00.000Z',
  });
  const current = { [authorId]: { name: "Mundo'Mau", avatar: 'https://new.example/avatar.png' } };
  assert.equal(displayAuthorName(savedPost.authorId, savedPost.authorName, current), "Mundo'Mau");
  assert.equal(displayAuthorAvatar(savedPost.authorId, savedPost.authorAvatar, current), 'https://new.example/avatar.png');
  assert.equal(displayAuthorName(authorId, 'Mauricio Francisco', current), "Mundo'Mau");
  assert.equal(savedPost.authorName, 'Mauricio Francisco', 'historical snapshot stays intact');
  assert.equal(savedPost.content, 'Texto publicado anteriormente');
  assert.equal(savedPost.authorId, authorId, 'authorship never moves to a different account');
});

test('missing profile, unrelated author and cleared avatar retain safe provenance semantics', () => {
  const profiles = { alice: { name: 'Alice Nova', avatar: '' } };
  assert.equal(displayAuthorName('bob', 'Bob Antigo', profiles), 'Bob Antigo');
  assert.equal(displayAuthorAvatar('bob', 'https://old.example/bob.png', profiles), 'https://old.example/bob.png');
  assert.equal(displayAuthorName('alice', 'Alice Antiga', profiles), 'Alice Nova');
  assert.equal(displayAuthorAvatar('alice', 'https://old.example/alice.png', profiles), '',
    'Removing the profile photo must not revive its historical image');
  assert.equal(displayAuthorName('alice', 'Alice Antiga', {}), 'Alice Antiga',
    'Network and permission errors can fall back to a historical snapshot');
});

test('community mural and forwarded Praça resolve both author and forwarder by UID', () => {
  const hook = read('src/hooks/useLiveAuthorIdentities.ts');
  const mural = read('src/components/CommunityPostCard.tsx');
  const praca = read('src/components/CommunitySquareFeedCard.tsx');
  const editor = read('src/components/ProfilePublicIdentityEditor.tsx');
  const feed = read('src/components/PublicSocialFeedPanel.tsx');

  assert.match(editor, /setDoc\(doc\(db, 'users', user\.uid\), fields, \{ merge: true \}\)/);
  assert.match(editor, /broadcastProfileUpdate\(user, name,/);
  assert.match(hook, /onSnapshot\(\s*doc\(db, 'users', uid\)/);
  assert.match(hook, /\/\^\[A-Za-z0-9_-\]\{1,128\}\$\//);
  assert.doesNotMatch(hook, /setDoc\(|updateDoc\(|deleteDoc\(/);
  assert.match(mural, /useLiveAuthorIdentities\(\[post\.authorId, \.\.\.postComments\.map\(comment => comment\.authorId\)\]\)/);
  assert.match(mural, /displayAuthorName\(post\.authorId, post\.authorName, liveAuthors\)/);
  assert.match(mural, /const displayComments = postComments\.map/);
  assert.match(praca, /useLiveAuthorIdentities\(\[post\.authorId, entry\.forwardedById \|\| ''\]\)/);
  assert.match(praca, /displayAuthorName\(entry\.forwardedById, entry\.forwardedByName \|\| 'Kairubido', liveAuthors\)/);
  assert.match(praca, /post=\{displayPost\}/);
  assert.match(feed, /currentNamePosts = useMemo/);
  assert.match(feed, /return currentNamePosts\.filter/);
});

test('visitor Praça keeps public projection but replaces old name only for public post authors', () => {
  const server = read('server/marketplace/publicSquareDiscoveryService.ts');
  assert.match(server, /authorUidByCardId\.set\(document\.id, str\(data\.authorId, 128\)\)/);
  assert.match(server, /const publicPosts = \[\.\.\.socialCards/);
  assert.match(server, /\.slice\(0, 40\)/);
  assert.match(server, /adminDb\.collection\('users'\)\.doc\(uid\)\.get\(\)/);
  assert.match(server, /return current \? \{ \.\.\.post, authorName: current\.name, authorAvatar: current\.avatar \} : post/);
  assert.doesNotMatch(server, /posts:\s*publicPosts\.map\(post => \(\{[^}]*authorId/);
});
