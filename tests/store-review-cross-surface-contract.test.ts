import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const modal = read('src/components/modals/MomentsModal.tsx');
const legacy = read('src/LegacyApp.tsx');
const publisher = read('src/utils/storeReviews.ts');
const hook = read('src/hooks/usePublicSocialFeed.ts');
const feed = read('src/components/PublicSocialFeedPanel.tsx');
const rules = read('firestore.social-feed.fragment.rules');
const moderation = read('server/admin/socialModerationService.ts');

test('Momentos publishes to canonical review record instead of local posts', () => {
  assert.match(legacy, /await publishStoreReview\(selectedStoreForMoments, data\)/);
  assert.doesNotMatch(legacy, /post-moment-/);
  assert.match(modal, /subscribeStoreReviews/);
  assert.match(modal, /Histórico antigo deste dispositivo/);
  assert.match(modal, /Não estão publicados no banco de avaliações/);
});

test('review and optional Praça post are atomic and linked with one identifier', () => {
  assert.match(publisher, /writeBatch\(db\)/);
  assert.match(publisher, /batch\.set\(reviewRef/);
  assert.match(publisher, /batch\.set\(doc\(db, 'social_posts', postId\)/);
  assert.match(publisher, /await batch\.commit\(\)/);
  assert.match(rules, /existsAfter\(post\)/);
  assert.match(rules, /existsAfter\(reviewPath\)/);
  assert.match(rules, /data\.postId == 'review_' \+ storeId \+ '_' \+ reviewId/);
  assert.match(rules, /data\.authorId == request\.auth\.uid/);
});

test('like count uses the very same Praça like records, not a second local counter', () => {
  assert.match(publisher, /collection\(db, 'social_post_likes'\)/);
  assert.match(modal, /likeCounts\[mom\.postId\]/);
  assert.match(hook, /collection\(db, 'social_post_likes'\)/);
  assert.match(hook, /storeReview: data\.storeReview/);
  assert.match(feed, /post\.storeReview/);
  assert.doesNotMatch(publisher, /from ['\"](?:\.\.?\/)*.*(?:gamification|pitanga)|grant[A-Z]|award[A-Z]/i);
});

test('removing a moderated Praça review also hides its canonical review and preserves the audit', () => {
  assert.match(moderation, /postRemoval\.delete\(postRef\)/);
  assert.match(moderation, /postRemoval\.update\(reviewRef/);
  assert.match(moderation, /status: 'hidden'/);
  assert.match(moderation, /hiddenReview, createdAt/);
  assert.match(moderation, /status: 'reviewed', resolution: 'removed'/);
});
