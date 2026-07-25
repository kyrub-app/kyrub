import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

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

test('Praça reads posts, likes and comments in realtime', () => {
  assert.match(hookSource, /collection\(db, 'social_posts'\)/);
  assert.match(hookSource, /collection\(db, 'social_post_likes'\)/);
  assert.match(hookSource, /collection\(db, 'social_post_comments'\)/);
  assert.match(hookSource, /toggleLike/);
  assert.match(hookSource, /addComment/);
  assert.match(kyrubSource, /usePublicSocialFeed/);
  assert.match(kyrubSource, /<PublicSocialFeedPanel/);
  assert.match(kyrubSource, /posts=\{socialFeed\.posts\}/);
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
