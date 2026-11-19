import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

test('main activates the cloud community bridges instead of the local preview', () => {
  const main = read('src/main.tsx');
  assert.match(main, /ProfileCommunitiesCloudBridge/);
  assert.match(main, /ProfilePublishingDestinationsCloudBridge/);
  assert.doesNotMatch(main, /ProfileCommunitiesPreviewBridge/);
  assert.doesNotMatch(main, /ProfilePublishingDestinationsPreviewBridge/);
});

test('community UI exposes debates and real comment continuation', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /label: 'Debates'/);
  assert.match(component, /Iniciar debate/);
  assert.match(component, /Escreva seu comentário neste debate/);
  assert.match(component, /Responder/);
  assert.match(component, /Editar/);
  assert.match(component, /deleteDebateComment/);
  assert.match(component, /approveCommunityMember/);
});

test('cloud data layer persists shared community resources in Firestore', () => {
  const cloud = read('src/utils/communityCloud.ts');
  for (const collectionName of [
    'communities',
    'community_members',
    'community_posts',
    'community_debates',
    'community_debate_comments',
  ]) {
    assert.match(cloud, new RegExp(`['\"]${collectionName}['\"]`));
  }
  assert.match(cloud, /runTransaction/);
  assert.match(cloud, /uploadCommunityCover/);
  assert.match(cloud, /importLocalCommunityPrototype/);
});

test('debate comment subscription scopes the query to community and debate', () => {
  const querySafe = read('src/utils/communityCloudQuerySafe.ts');
  const vite = read('vite.config.ts');

  assert.match(querySafe, /community_debates/);
  assert.match(querySafe, /where\('communityId', '==', communityId\)/);
  assert.match(querySafe, /where\('debateId', '==', debateId\)/);
  assert.match(vite, /communityCloudQuerySafe\.ts/);
});

test('Firestore and Storage compose dedicated community authorization', () => {
  const fragment = read('firestore.communities.fragment.rules');
  const compose = read('scripts/compose-firestore-rules.mjs');
  const storage = read('storage.rules');
  assert.match(fragment, /match \/communities\/\{communityId\}/);
  assert.match(fragment, /match \/community_debates\/\{debateId\}/);
  assert.match(
    fragment,
    /match \/community_debate_comments\/\{commentId\}/
  );
  assert.match(compose, /firestore\.communities\.fragment\.rules/);
  assert.match(storage, /match \/community-covers\/\{communityId\}/);
});

test('switching communities clears the previous wall and rejects late snapshots', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /const communitySubscriptionVersion = useRef\(0\)/);
  assert.match(component, /const version = \+\+communitySubscriptionVersion\.current/);
  assert.match(component, /const isCurrent = \(\) => communitySubscriptionVersion\.current === version/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setPosts\(values\); \}/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setDebates\(values\); \}/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setMembers\(values\); \}/);
  assert.match(component, /\+\+communitySubscriptionVersion\.current;\s+setPosts\(\[\]\);\s+setDebates\(\[\]\);\s+setMembers\(\[\]\);\s+closeDebate\(\);/);
  assert.match(component, /const closeDebate = \(\) => \{\s+\+\+debateSubscriptionVersion\.current;\s+setComments\(\[\]\);/);
});

test('switching debates resets the comment composer and ignores late debate snapshots', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /const debateSubscriptionVersion = useRef\(0\)/);
  assert.match(component, /const version = \+\+debateSubscriptionVersion\.current/);
  assert.match(component, /setComments\(\[\]\);\s+if \(!selectedCommunityId \|\| !selectedDebateId\) return/);
  assert.match(component, /const isCurrent = \(\) => debateSubscriptionVersion\.current === version/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setComments\(values\); \}/);
  assert.match(component, /\[selectedCommunityId, selectedDebateId\]/);
  assert.match(component, /const closeDebate = \(\) => \{\s+\+\+debateSubscriptionVersion\.current;\s+setComments\(\[\]\);\s+setReplyTo\(null\);\s+setCommentDraft\(''\);\s+setEditingCommentId\(''\);\s+setEditingCommentText\(''\);\s+setSelectedDebateId\(''\);/);
  assert.match(component, /const openDebate = \(debateId: string\) => \{\s+closeDebate\(\);\s+setSelectedDebateId\(debateId\);/);
  assert.match(component, /openDebate\(debate\.id\)/);
  assert.match(component, /onClick=\{closeDebate\}/);
});

test('private group navigation rejects stale messages and cross-community membership snapshots', () => {
  const component = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(component, /const groupDirectorySubscriptionVersion = useRef\(0\)/);
  assert.match(component, /const groupMessageSubscriptionVersion = useRef\(0\)/);
  assert.match(component, /group\.communityId === selectedCommunityId/);
  assert.match(component, /group\.memberIds\.includes\(user\.uid\)/);
  assert.match(component, /const isCurrent = \(\) => groupMessageSubscriptionVersion\.current === version/);
  assert.match(component, /values => \{ if \(isCurrent\(\)\) setGroupMessages\(values\); \}/);
  assert.match(component, /const isCurrent = \(\) => groupDirectorySubscriptionVersion\.current === version/);
  assert.match(component, /setMyCommunityGroups\(values\.filter\(group => group\.communityId === selectedCommunityId\)\)/);
  assert.match(component, /const closeGroupsModal = \(\) => \{[\s\S]*?setActiveGroupChatId\(''\);[\s\S]*?setGroupMessages\(\[\]\);/);
  assert.match(component, /const toggleGroupConversation = \(groupId: string\) => \{[\s\S]*?setGroupMessages\(\[\]\);[\s\S]*?setGroupMessageDraft\(''\);/);
  assert.match(component, /onClick=\{\(\) => toggleGroupConversation\(group\.id\)\}/);
  assert.match(component, /const openCommunity = \(community: CloudCommunity\) => \{[\s\S]*?closeGroupsModal\(\);/);
});


test('Taba shows Lojas before a single Comunidades panel without device-test imports', () => {
  const tab = read('src/components/tabs/KyrubTab.tsx');
  const stores = read('src/components/tabs/SquareStoresSection.tsx');
  const communities = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.ok(tab.indexOf('<SquareStoresSection') >= 0);
  assert.ok(tab.indexOf('<SquareStoresSection') < tab.indexOf('<LegacyKyrubTab'));
  assert.match(tab, /props\.setSocialSubTab\('lojas'\)/);
  assert.equal((communities.match(/id="square-communities"/g) || []).length, 1);
  assert.doesNotMatch(communities, /Importar teste deste aparelho|showLocalImport|importLocalCommunityPrototype/);
  assert.match(communities, /Criar comunidade/);
  assert.match(stores, /id="square-stores"/);
  assert.match(stores, /Ver todas/);
  for (const name of ["'Minhas'", "'Descobrir'", "'Em alta'"]) {
    assert.ok(stores.includes(name));
  }
  assert.ok(stores.includes("fetch('/api/marketplace-discovery/public/kyrub-oficial'"));
  assert.match(stores, /href=\{OFFICIAL_STORE_PATH\}/);
  assert.ok(stores.includes("const OFFICIAL_STORE_PATH = '/@kyrub-oficial';"));
  assert.doesNotMatch(stores, /Criar comunidade|Importar teste deste aparelho/);
});


test('community wall editor has a single About-tab Edit, media picker and readable text', () => {
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const cloud = read('src/utils/communityCloud.ts');
  const card = read('src/components/CommunityPostCard.tsx');
  const storage = read('storage.rules');
  const coverHeader = ui.slice(ui.indexOf('<CommunityCover community={selectedCommunity}'), ui.indexOf('<nav className="flex gap-1', ui.indexOf('<CommunityCover community={selectedCommunity}')));
  assert.doesNotMatch(coverHeader, /onClick=\{openEditor\}/);
  assert.match(ui, /\{pageTab === 'about' && \(/);
  assert.match(ui, /onClick=\{openEditor\}/);
  assert.match(ui, /id="community-wall-attachment-button"/);
  assert.match(ui, /aria-label="Adicionar foto, vídeo ou câmera ao mural"/);
  assert.match(ui, /Fotos da galeria/);
  assert.match(ui, /accept="video\/mp4,video\/webm"/);
  assert.match(ui, /capture="environment"/);
  assert.match(ui, /Até 4 anexos/);
  assert.match(ui, /uploadCommunityPostMedia\(communityId, item\.file\)/);
  assert.match(ui, /createCommunityPost\(\{ communityId, content, mediaUrls \}\)/);
  assert.match(ui, /<CommunityPostCard/);
  assert.match(card, /<MediaCarousel mediaUrls=\{post\.mediaUrls\} \/>/);
  assert.match(ui, /text-sm text-white outline-none/);
  assert.doesNotMatch(ui, /text-\[(8|9|10)px\]/);
  assert.match(cloud, /community-post-media\/\$\{communityId\}\/\$\{user\.uid\}/);
  assert.match(storage, /match \/community-post-media\/\{communityId\}\/\{ownerId\}\/\{fileName\}/);
  assert.match(storage, /canPublishCommunityMedia\(communityId\)/);
});

test('community cover, tabs and mural share one scroll region with back-to-top control', () => {
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const start = ui.indexOf('id="community-page-scroll"');
  const end = ui.indexOf('aria-label="Voltar ao topo da comunidade"', start);
  assert.ok(start >= 0 && end > start, 'community scroll area and top action exist');
  const page = ui.slice(start, end);
  assert.match(page, /ref=\{communityScrollRef\}/);
  assert.match(page, /onScroll=\{event => setShowBackToTop\(event\.currentTarget\.scrollTop > 240\)\}/);
  assert.ok(page.indexOf('<header') < page.indexOf('<nav') && page.indexOf('<nav') < page.indexOf('<main'));
  assert.match(page, /<main className="p-4 pb-24">/);
  assert.doesNotMatch(page, /<main className="flex-1 overflow-y-auto p-4">/);
  assert.match(ui, /onClick=\{\(\) => communityScrollRef\.current\?\.scrollTo\(\{ top: 0, behavior: 'smooth' \}\)\}/);
  assert.match(ui, /<ArrowUp className="h-5 w-5" \/>/);
  assert.match(ui, /setPageTab\(tab\.id\);[\s\S]*?setShowBackToTop\(false\);/);
  assert.match(ui, /<main className="flex-1 overflow-y-auto p-4">/); // Debate keeps its independent conversation scroll.
});

test('community cards reuse canonical saved actions and have persisted likes, comments and report menu', () => {
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const card = read('src/components/CommunityPostCard.tsx');
  const interactions = read('src/utils/communityPostInteractions.ts');
  const connections = read('src/utils/communityPostConnections.ts');
  const rules = read('firestore.communities.fragment.rules');
  const moderation = read('server/admin/socialModerationService.ts');
  assert.match(ui, /saved=\{savedPostIds\.has\(post\.id\)\}/);
  assert.match(ui, /toggleCommunityPostSaveWithMetrics\(post, savedPostIds\.has\(post\.id\)\)/);
  assert.match(card, /Mais opções da publicação/);
  for (const label of ['Conectar', 'Conversar', 'Ver perfil', 'Denunciar publicação', 'Salvar']) {
    assert.ok(card.includes(label));
  }
  assert.match(card, /<ChatModal/);
  assert.match(card, /onToggleLike\(isLiked\)/);
  assert.match(card, /onComment\(commentDraft\)/);
  assert.match(interactions, /collection\(db, 'community_post_likes'\)/);
  assert.match(interactions, /collection\(db, 'community_post_comments'\)/);
  assert.match(interactions, /community_post_reports/);
  assert.match(connections, /collection\(db, 'connections'\)/);
  for (const collectionName of ['community_post_likes', 'community_post_comments', 'community_post_reports']) {
    assert.ok(rules.includes('match /' + collectionName));
  }
  assert.match(moderation, /'community_post_reports'/);
  assert.match(moderation, /removeModeratedCommunityPost/);
});

test('author menu removes the publication after confirmation, without self-connection or self-report', () => {
  const card = read('src/components/CommunityPostCard.tsx');
  const container = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const client = read('src/utils/communityPostInteractions.ts');
  const api = read('api/admin/operations/health.ts');
  const service = read('server/communities/communityPostRemovalService.ts');
  const moderation = read('server/admin/socialModerationService.ts');

  assert.match(card, /const isMine = viewerId === post\.authorId/);
  assert.match(card, /\{isMine && \([\s\S]*?Remover publicação/);
  assert.match(card, /window\.confirm\('Remover esta publicação definitivamente/);
  assert.match(card, /void run\('remove', onRemove\)/);
  assert.doesNotMatch(card, /Ocultar publicação/);
  assert.match(card, /\{!isMine && !connection && \(/);
  assert.match(card, /\{!isMine && connected && \(/);
  assert.match(card, /\{!isMine && \([\s\S]*?Denunciar publicação/);
  assert.match(container, /onRemove=\{\(\) => removeOwnCommunityPost\(post\)\}/);
  assert.match(client, /transport=community-author-remove/);
  assert.match(client, /post\.authorId !== user\.uid/);

  assert.match(api, /transport === 'community-author-remove'/);
  assert.match(api, /method !== 'POST'/);
  assert.match(service, /verifyFirebaseIdToken\(token\)/);
  assert.match(service, /adminDb\.runTransaction\(async tx =>/);
  assert.match(service, /post\.authorId !== actor\.uid/);
  assert.match(service, /tx\.delete\(postRef\)/);
  assert.match(service, /community\.post\.author_removed/);
  assert.match(service, /cleanupRemovedCommunityPost\(postId, data\)/);
  assert.match(service, /community_post_likes/);
  assert.match(service, /community_post_comments/);
  assert.match(service, /community-post-media/);
  assert.doesNotMatch(service, /collection\('community_post_reports'\).*?delete/);
  assert.match(moderation, /cleanupRemovedCommunityPost\(postId, data\)/);
});

test('Promover entry only appears for a community post author and never starts a paid campaign', () => {
  const card = read('src/components/CommunityPostCard.tsx');
  const preview = read('src/components/ads/KyrubAdsCommunityPromotionPreview.tsx');

  assert.match(card, /const isMine = viewerId === post\.authorId/);
  assert.match(card, /\{isMine && \([\s\S]*?<Megaphone className="h-4 w-4" \/> Promover/);
  assert.match(card, /setPromotionPreviewOpen\(true\)/);
  assert.match(card, /promotionPreviewOpen && isMine/);
  assert.match(card, /<KyrubAdsCommunityPromotionPreview post=\{post\}/);

  for (const period of [7, 15, 21, 30]) {
    assert.ok(preview.includes(String(period)), 'Campaign draft duration missing: ' + period);
  }
  assert.match(preview, /Kyrub Ads/);
  assert.match(preview, /Patrocinado · Prévia/);
  assert.match(preview, /nenhuma campanha é criada e nenhum pagamento é iniciado/);
  assert.match(preview, /após homologação do Kyrub Ads/);
  assert.doesNotMatch(preview, /\bfetch\s*\(|\bsetDoc\s*\(|\baddDoc\s*\(|\buploadBytes\s*\(/);
  assert.doesNotMatch(preview, /\bMercadoPago\b|\bcheckout\b|\bPix\b/);
});

test('community organic metrics appear only for their author and never conflate Kyrub Ads data', () => {
  const card = read('src/components/CommunityPostCard.tsx');
  const cloudUI = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const metrics = read('src/utils/communityOrganicMetrics.ts');
  const rules = read('firestore.communities.fragment.rules');
  const cleanup = read('server/communities/communityPostRemovalService.ts');

  assert.match(card, /\{isMine && \([\s\S]*?Métricas da publicação/);
  assert.match(card, /metricsOpen && isMine/);
  assert.match(card, /const organicCounts = \{/);
  for (const label of ['Visualizações', 'Curtidas', 'Salvamentos', 'Compartilhamentos', 'Comentários']) {
    assert.ok(card.includes(label), 'Métrica orgânica ausente: ' + label);
  }
  assert.match(card, /<BarChart3 className="h-4 w-4" \/> Métricas da publicação/);
  assert.match(card, /<Megaphone className="h-4 w-4"\/> Promover no Kyrub Ads/);
  assert.match(card, /entry\.intersectionRect\.height < 0\.55 \* visibleReference/);
  assert.match(card, /recordCommunityPostView\(post\)/);
  assert.match(card, /shareCommunityPostWithMetrics\(post\)/);
  assert.match(metrics, /navigator\.share\(/);
  assert.match(metrics, /navigator\.clipboard/);
  assert.match(metrics, /await setDoc\(reference, newEngagement\(post, actorId, 'share', reference\.id\)\)/);
  assert.match(metrics, /runTransaction\(db/);
  assert.match(metrics, /tx\.set\(savedRef/);
  assert.match(metrics, /tx\.set\(metricRef/);
  assert.match(metrics, /tx\.delete\(savedRef\)/);
  assert.match(metrics, /tx\.delete\(metricRef\)/);
  assert.match(cloudUI, /toggleCommunityPostSaveWithMetrics\(post, savedPostIds\.has\(post\.id\)\)/);
  assert.match(rules, /match \/community_post_engagements\/\{engagementId\}/);
  assert.match(rules, /incoming\(\)\.actorId == request\.auth\.uid/);
  assert.match(rules, /existing\(\)\.postAuthorId == request\.auth\.uid/);
  assert.match(cleanup, /'community_post_engagements'/);
  assert.doesNotMatch(metrics, /mercadoPago|campaign|pitangas|wallet|checkout|pix/i);
});

test('Praça shares canonical public community posts for 24h without duplicating content, rewards or paid campaigns', () => {
  const cloud = read('src/utils/communityCloud.ts');
  const index = read('src/utils/communitySquareFeed.ts');
  const card = read('src/components/CommunitySquareFeedCard.tsx');
  const feed = read('src/components/PublicSocialFeedPanel.tsx');
  const cloudUI = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const hub = read('src/components/ProfileSocialHubNative.tsx');
  const rules = read('firestore.communities.fragment.rules');
  const cleanup = read('server/communities/communityPostRemovalService.ts');

  assert.match(cloud, /const publishToSquare = input.shareToSquare !== false && community\?\.visibility === 'public'/);
  assert.match(cloud, /batch\.set\(reference/);
  assert.match(cloud, /batch\.set\(doc\(db, 'community_square_posts', reference\.id\)/);
  assert.match(cloud, /await batch\.commit\(\)/);
  assert.match(cloudUI, /Exibir também na Praça por 24 horas/);
  assert.match(cloudUI, /shareToSquare: selectedCommunity.visibility === 'public' && shareWallToSquare/);
  assert.match(cloudUI, /selectedCommunity.visibility === 'moderated'/);
  assert.match(cloudUI, /selectedCommunity.visibility === 'private'/);
  assert.match(cloudUI, /subscribeCommunitySquareIds/);
  assert.match(read('src/components/CommunityPostCard.tsx'), /Retirar da Praça/);
  assert.match(read('src/components/CommunityPostCard.tsx'), /Mostrar na Praça/);

  assert.match(index, /24 \* 60 \* 60 \* 1000/);
  assert.match(index, /COMMUNITY_SQUARE_MAX_VISIBLE = 30/);
  assert.match(index, /COMMUNITY_SQUARE_MAX_PER_COMMUNITY = 3/);
  assert.match(index, /community.visibility !== 'public'/);
  assert.match(index, /onSnapshot\(doc\(db, 'communities', pointer\.communityId\)/);
  assert.match(index, /onSnapshot\(doc\(db, 'community_posts', pointer\.postId\)/);
  assert.match(index, /window\.setInterval\(publish, 60_000\)/);
  assert.match(index, /withinCommunitySquareWindow/);
  assert.match(index, /post\.communityId !== pointer\.communityId/);
  assert.match(index, /post\.authorId !== pointer\.authorId/);
  assert.match(index, /query\([\s\S]*?community_square_posts[\s\S]*?where\('createdAt', '>=',/);
  assert.match(card, /<CommunityPostCard/);
  assert.match(card, /toggleCommunityPostLike/);
  assert.match(card, /addCommunityPostComment/);
  assert.match(card, /toggleCommunityPostSaveWithMetrics/);
  assert.match(card, /removeOwnCommunityPost/);
  assert.match(feed, /feedRows\.map\(row =>/);
  assert.match(feed, /kind: 'community' as const/);
  assert.match(feed, /kind: 'social' as const/);
  assert.match(feed, /Date\.parse\(b\.createdAt\) - Date\.parse\(a\.createdAt\)/);
  assert.match(feed, /withinCommunitySquareWindow\(Date\.parse\(post\.createdAt/);
  assert.match(hub, /setActiveTab\('square'\)/);
  assert.match(cloudUI, /OPEN_COMMUNITY_FROM_SQUARE_EVENT/);
  assert.match(rules, /match \/community_square_posts\/\{postId\}/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/community_posts\/\$\(postId\)\)\.data\.createdAt == incoming\(\)\.createdAt/);
  assert.match(rules, /\.data\.visibility == 'public'/);
  assert.match(rules, /allow update: if false/);
  assert.match(cleanup, /adminDb\.collection\('community_square_posts'\)\.doc\(postId\)\.delete\(\)/);
  assert.doesNotMatch(index, /payment|mercadoPago|pitangas|wallet|checkout|sponsored/i);
});
