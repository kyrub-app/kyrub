import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const bridgeSource = readFileSync(
  'src/components/ProfilePostInteractionsBridge.tsx',
  'utf8'
);
const feedSource = readFileSync('src/hooks/usePublicSocialFeed.ts', 'utf8');
const socialRules = readFileSync(
  'firestore.social-feed.fragment.rules',
  'utf8'
);

test('like, comment and share stay together in this order', () => {
  assert.match(appSource, /<ProfilePostInteractionsBridge\s*\/?>/);
  assert.match(bridgeSource, /aria-label="Ações da publicação"/);
  const likeIndex = bridgeSource.indexOf('Curtir {item.post.likes}');
  const commentIndex = bridgeSource.indexOf(
    'Comentar {item.post.commentCount ?? 0}'
  );
  const shareIndex = bridgeSource.indexOf('Compartilhar');
  assert.ok(likeIndex >= 0);
  assert.ok(likeIndex < commentIndex);
  assert.ok(commentIndex < shareIndex);
  assert.match(bridgeSource, /grid grid-cols-3/);
  assert.doesNotMatch(bridgeSource, /Quem curtiu/);
  assert.match(bridgeSource, /navigator\.share/);
  assert.match(bridgeSource, /navigator\.clipboard\.writeText/);
  assert.match(feedSource, /commentsByPost/);
  assert.match(feedSource, /addComment/);
});

test('the author menu exposes metrics and confirmed deletion', () => {
  assert.match(bridgeSource, /post\.authorId === user\?\.uid/);
  assert.match(bridgeSource, /Métricas da publicação/);
  assert.match(bridgeSource, /Visualizações/);
  assert.match(bridgeSource, /Curtidas/);
  assert.match(bridgeSource, /Salvamentos/);
  assert.match(bridgeSource, /Compartilhamentos/);
  assert.match(bridgeSource, /Comentários/);
  assert.match(bridgeSource, /Patrocinar publicação/);
  assert.match(bridgeSource, /kyrub-sponsor-post-requested/);
  assert.match(bridgeSource, /Excluir publicação/);
  assert.match(bridgeSource, /Excluir Status/);
  assert.match(bridgeSource, /deleteDoc\(doc\(db, 'social_posts'/);
  assert.match(bridgeSource, /deleteCandidate\.authorId !== user\.uid/);
  assert.match(bridgeSource, /A remoção é permanente/);
  assert.match(bridgeSource, /kyrub-social-posts-updated/);
});

test('metrics use real secured engagement events', () => {
  assert.match(bridgeSource, /social_post_engagements/);
  assert.match(bridgeSource, /IntersectionObserver/);
  assert.match(bridgeSource, /recordEngagement\(post, 'view', true\)/);
  assert.match(bridgeSource, /recordEngagement\(post, 'save', true\)/);
  assert.match(bridgeSource, /recordEngagement\(post, 'share', false\)/);
  assert.match(socialRules, /match \/social_post_engagements\/\{engagementId\}/);
  assert.match(socialRules, /incoming\(\)\.type in \['view', 'save', 'share'\]/);
  assert.match(socialRules, /existing\(\)\.postAuthorId == request\.auth\.uid/);
});

test('interaction recovery remains scoped without mutation observers', () => {
  assert.doesNotMatch(bridgeSource, /MutationObserver/);
  assert.match(bridgeSource, /profile-social-hub-modal/);
  assert.match(bridgeSource, /data-profile-post-interactions-slot/);
  assert.match(bridgeSource, /data-profile-post-menu-slot/);
});
