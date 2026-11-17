import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const modal = read('src/components/modals/MomentsModal.tsx');
const storefront = read('src/components/PublicStorefrontApp.tsx');
const legacy = read('src/LegacyApp.tsx');
const publisher = read('src/utils/storeReviews.ts');
const hook = read('src/hooks/usePublicSocialFeed.ts');
const feed = read('src/components/PublicSocialFeedPanel.tsx');
const rules = read('firestore.social-feed.fragment.rules');
const moderation = read('server/admin/socialModerationService.ts');
const reportClient = read('src/utils/storeReviewReports.ts');
const adminWorkspace = read('src/components/admin/AdminSocialModerationWorkspace.tsx');
const adminTransport = read('api/admin/operations/health.ts');
const reviewRules = read('firestore.social-feed.fragment.rules');

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
  assert.match(moderation, /hiddenReview, resolvedReviewReports, createdAt/);
  assert.match(moderation, /status: 'reviewed', resolution: 'removed'/);
});

test('public buyer storefront opens the same review publisher used by the Praça', () => {
  assert.match(storefront, /public-storefront-reviews-trigger/);
  assert.match(storefront, /<MomentsModal/);
  assert.match(storefront, /await publishStoreReview\(store, data\)/);
  assert.match(storefront, /handleGoogleLogin\(\)/);
});

test('store-only review complaints have authenticated immutable Firestore receipts and no automatic penalties', () => {
  assert.match(reportClient, /submitStoreReviewReport/);
  assert.match(reportClient, /setDoc\(reportRef/);
  assert.match(reportClient, /'store_review_reports'/);
  assert.match(reviewRules, /match \/store_review_reports\/\{reportId\}/);
  assert.match(reviewRules, /get\(targetReview\(\)\)\.data\.status == 'published'/);
  assert.match(reviewRules, /incoming\(\)\.authorId != request\.auth\.uid/);
  assert.match(reviewRules, /allow list, update, delete: if false/);
  assert.doesNotMatch(reportClient, /grantPitanga|awardXP|rewardLedger|walletCredit/);
});

test('store-only complaints can reach authorized audited moderation, hide review, or be dismissed', () => {
  assert.match(adminTransport, /social-moderation-store-review-hide/);
  assert.match(adminTransport, /hideModeratedStoreReview\(authorization, body\.storeId, body\.reviewId, body\.reason\)/);
  assert.match(moderation, /collection\('store_review_reports'\)\.where\('status', '==', 'pending'\)/);
  assert.match(moderation, /resolvePendingReviewReports/);
  assert.match(moderation, /status: 'hidden', reviewedBy: admin\.uid/);
  assert.match(moderation, /action: 'admin\.social\.store_review\.hidden'/);
  assert.match(moderation, /kind !== 'post' && kind !== 'user' && kind !== 'review'/);
  assert.match(adminWorkspace, /Ocultar avaliação/);
  assert.match(adminWorkspace, /Encerrar com justificativa/);
  assert.match(adminWorkspace, /social-moderation-report-review/);
});

test('Momentos reports standalone or shared reviews with confirmed Firebase writes, not localStorage', () => {
  assert.match(modal, /submitStoreReviewReport\(storeId, reviewId, reportReason\)/);
  assert.match(modal, /Denunciar avaliação/);
  assert.match(modal, /Denúncia encaminhada à moderação do Kyrub/);
  assert.match(modal, /A denúncia não foi enviada/);
  assert.doesNotMatch(reportClient, /localStorage|sessionStorage/);
});
