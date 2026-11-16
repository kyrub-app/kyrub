import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { SocialPost } from '../src/types';
import { selectPublicSquarePosts } from '../src/utils/publicSquareFeed';

const appSource = readFileSync('src/App.tsx', 'utf8');
const bridgeSource = readFileSync(
  'src/components/SocialPublishingBridge.tsx',
  'utf8'
);
const feedSource = readFileSync(
  'src/components/PublicSocialFeedPanel.tsx',
  'utf8'
);
const hookSource = readFileSync(
  'src/hooks/usePublicSocialFeed.ts',
  'utf8'
);
const kyrubSource = readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const firebaseSource = readFileSync('src/utils/firebase.ts', 'utf8');
const firebaseConfig = JSON.parse(readFileSync('firebase.json', 'utf8'));
const storageRules = readFileSync('storage.rules', 'utf8');

test('local profile publications are migrated to Firestore and Storage', () => {
  assert.match(appSource, /<SocialPublishingBridge \/>/);
  assert.match(bridgeSource, /collection\(db, 'social_posts'\)/);
  assert.match(bridgeSource, /uploadString\(/);
  assert.match(bridgeSource, /getDownloadURL\(/);
  assert.match(bridgeSource, /social-posts\/\$\{userId\}/);
  assert.match(bridgeSource, /kyrub-social-posts-updated/);
  assert.match(firebaseSource, /getStorage/);
  assert.match(firebaseSource, /export const storage/);
});

test('cloud state broadcasts cannot synchronously consume themselves', () => {
  assert.match(bridgeSource, /source\?: 'local' \| 'cloud'/);
  assert.match(bridgeSource, /source: 'cloud'/);
  assert.match(bridgeSource, /detail\?\.source === 'cloud'/);
  assert.match(bridgeSource, /lastPublishedCloudSignature/);
  assert.match(bridgeSource, /cloudSignature === lastPublishedCloudSignature/);
});

test('Praça reads posts, likes and comments in realtime', () => {
  assert.match(hookSource, /collection\(db, 'social_posts'\)/);
  assert.match(hookSource, /collection\(db, 'social_post_likes'\)/);
  assert.match(hookSource, /collection\(db, 'social_post_comments'\)/);
  assert.match(hookSource, /toggleLike/);
  assert.match(hookSource, /addComment/);
  assert.match(kyrubSource, /usePublicSocialFeed/);
  assert.match(kyrubSource, /<PublicSocialFeedPanel/);
  assert.match(kyrubSource, /<PublicSocialFeedPanel[\s\S]*?posts=\{squarePosts\}/);
  assert.match(kyrubSource, /<LegacyKyrubTab[\s\S]*?posts=\{socialFeed\.posts\}/);
});

test('public feed cards expose realtime likes and comments', () => {
  assert.match(feedSource, /curtida/);
  assert.match(feedSource, /comentário/);
  assert.match(feedSource, /Escreva um comentário/);
  assert.match(feedSource, /onToggleLike\(post\.id\)/);
  assert.match(feedSource, /onAddComment\(postId, text\)/);
});

test('Firebase deploy configuration includes social Firestore and Storage security', () => {
  assert.equal(firebaseConfig.storage.rules, 'storage.rules');
  assert.match(storageRules, /request\.auth\.uid == userId/);
  assert.match(storageRules, /request\.resource\.contentType\.matches\('image\/\.\*'\)/);
});

test('Praça shows public publications only; private posts and connected Status stay scoped', () => {
  const now = Date.parse('2026-11-16T15:00:00Z');
  const post = (
    id: string,
    visibility: SocialPost['visibility'],
    publicationType: SocialPost['publicationType'] = 'feed'
  ): SocialPost => ({
    id,
    user: 'Kairubido',
    avatar: '',
    time: 'Agora mesmo',
    content: id,
    likes: 0,
    visibility,
    publicationType,
    authorId: 'author',
    createdAt: new Date(now - 1000).toISOString(),
  });
  const shared = [
    post('public-feed', 'public'),
    post('private-timeline', 'private'),
    post('connected-status', 'connections', 'status'),
    post('public-status', 'public', 'status'),
    { ...post('expired-public-status', 'public', 'status'), createdAt: new Date(now - 24 * 60 * 60 * 1000).toISOString() },
    { ...post('invalid-time-status', 'public', 'status'), createdAt: '' },
    post('own-private-post', 'private'),
    post('legacy-without-visibility', undefined),
  ];
  const square = selectPublicSquarePosts(shared, now);
  assert.deepEqual(square.map(item => item.id), ['public-feed', 'public-status']);
  assert.equal(shared.length, 8, 'personal/connected feeds are not mutated');
  assert.match(kyrubSource, /selectPublicSquarePosts\(socialFeed\.posts, squareNow\)/);
  assert.match(kyrubSource, /setInterval\(\(\) => setSquareNow\(Date\.now\(\)\), 60_000\)/);
  assert.match(kyrubSource, /posts=\{squarePosts\}/);
});
