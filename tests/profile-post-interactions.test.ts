import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const bridgeSource = readFileSync(
  'src/components/ProfilePostInteractionsBridge.tsx',
  'utf8'
);
const feedSource = readFileSync('src/hooks/usePublicSocialFeed.ts', 'utf8');

test('profile publications expose comments, likers and native sharing', () => {
  assert.match(appSource, /<ProfilePostInteractionsBridge\s*\/?>/);
  assert.match(bridgeSource, /Comentar \{item\.post\.commentCount \?\? 0\}/);
  assert.match(bridgeSource, /Quem curtiu \{item\.post\.likes\}/);
  assert.match(bridgeSource, /Compartilhar/);
  assert.match(bridgeSource, /navigator\.share/);
  assert.match(bridgeSource, /navigator\.clipboard\.writeText/);
  assert.match(feedSource, /commentsByPost/);
  assert.match(feedSource, /addComment/);
});

test('only the author receives a confirmed delete action', () => {
  assert.match(bridgeSource, /post\.authorId === user\?\.uid/);
  assert.match(bridgeSource, /Excluir publicação/);
  assert.match(bridgeSource, /Excluir Status/);
  assert.match(bridgeSource, /deleteDoc\(doc\(db, 'social_posts'/);
  assert.match(bridgeSource, /deleteCandidate\.authorId !== user\.uid/);
  assert.match(bridgeSource, /A remoção é permanente/);
  assert.match(bridgeSource, /kyrub-social-posts-updated/);
});

test('interaction recovery remains scoped without mutation observers', () => {
  assert.doesNotMatch(bridgeSource, /MutationObserver/);
  assert.match(bridgeSource, /profile-social-hub-modal/);
  assert.match(bridgeSource, /data-profile-post-interactions-slot/);
  assert.match(bridgeSource, /data-profile-post-delete-slot/);
});
