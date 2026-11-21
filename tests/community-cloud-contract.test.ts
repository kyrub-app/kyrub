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

test('Communities present one Mural with lasting post comments and no separate Debates module', () => {
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const postCard = read('src/components/CommunityPostCard.tsx');
  const postActions = read('src/utils/communityPostInteractions.ts');
  assert.match(ui, /type CommunityPageTab = 'wall' \| 'notices' \| 'about'/);
  for (const tab of ["label: 'Mural'", "label: 'Avisos'", "label: 'Sobre'"]) {
    assert.ok(ui.includes(tab), `Missing community navigation: ${tab}`);
  }
  assert.doesNotMatch(ui, /label: 'Debates'|Iniciar debate|Publicar debate|selectedDebateId|setDebates|subscribeCommunityDebates/);
  assert.match(ui, /<CommunityPostCard/);
  assert.match(postCard, /Comentar/);
  assert.match(postActions, /collection\(db, 'community_post_comments'\)/);
  assert.match(ui, /approveCommunityMember/);
});

test('community data layer uses canonical posts and retains no debate writers or import jobs', () => {
  const cloud = read('src/utils/communityCloud.ts');
  for (const name of ['communities', 'community_members', 'community_posts']) {
    assert.match(cloud, new RegExp(`['"]${name}['"]`));
  }
  assert.doesNotMatch(cloud, /community_debates|community_debate_comments|createCommunityDebate|localDebates/i);
  assert.match(cloud, /runTransaction/);
  assert.match(cloud, /uploadCommunityCover/);
  assert.match(cloud, /importLocalCommunityPrototype/);
});

test('retired debate documents remain readable for historical retention, never writable again', () => {
  const fragment = read('firestore.communities.fragment.rules');
  const compose = read('scripts/compose-firestore-rules.mjs');
  const storage = read('storage.rules');
  assert.match(fragment, /match \/communities\/\{communityId\}/);
  for (const collectionName of ['community_debates', 'community_debate_comments']) {
    const section = fragment.match(new RegExp(`match /${collectionName}/\\{[^}]+\\} \\{([^}]+)\\}`))?.[1] || '';
    assert.match(section, /allow read: if canReadCommunity\(existing\(\)\.communityId\)/);
    assert.match(section, /allow create, update, delete: if false;/);
  }
  assert.match(compose, /firestore\.communities\.fragment\.rules/);
  assert.match(storage, /match \/community-covers\/\{communityId\}/);
});

test('switching Communities cancels previous mural and membership listeners', () => {
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(ui, /const communitySubscriptionVersion = useRef\(0\)/);
  assert.match(ui, /const version = \+\+communitySubscriptionVersion\.current/);
  assert.match(ui, /const isCurrent = \(\) => communitySubscriptionVersion\.current === version/);
  assert.match(ui, /values => \{ if \(isCurrent\(\)\) setPosts\(values\); \}/);
  assert.match(ui, /values => \{ if \(isCurrent\(\)\) setMembers\(values\); \}/);
  assert.match(ui, /unsubscribePosts\(\)/);
  assert.match(ui, /unsubscribeMembers\(\)/);
  assert.doesNotMatch(ui, /debateSubscriptionVersion|subscribeDebateComments|closeDebate/);
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
  assert.match(tab, /onViewAll=\{\(\) => setStoreCatalogOpen\(true\)\}/);
  assert.equal((communities.match(/id="square-communities"/g) || []).length, 1);
  assert.doesNotMatch(communities, /Importar teste deste aparelho|showLocalImport|importLocalCommunityPrototype/);
  assert.match(communities, /Criar comunidade/);
  assert.match(stores, /id="square-stores"/);
  assert.match(stores, /Ver todas/);
  for (const name of ["'Participante'", "'Favoritos'", "'Em alta'"]) {
    assert.ok(stores.includes(name));
  }
  assert.ok(stores.includes("fetch('/api/marketplace-discovery/public/kyrub-oficial'"));
  assert.match(stores, /href=\{OFFICIAL_STORE_PATH\}/);
  assert.ok(stores.includes("const OFFICIAL_STORE_PATH = '/@kyrub-oficial';"));
  assert.doesNotMatch(stores, /Criar comunidade|Importar teste deste aparelho/);
});


test('Community header opens a searchable full directory instead of duplicating create action', () => {
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const header = ui.slice(ui.indexOf('id="square-communities"'), ui.indexOf('aria-label="Filtros do catálogo de comunidades"'));
  assert.match(header, /aria-label="Ver todas as comunidades"/);
  assert.match(header, /Ver todas <ArrowRight/);
  assert.doesNotMatch(header.slice(0, header.indexOf('<div className="flex gap-1.5 overflow-x-auto">')), /onClick=\{\(\) => setCreateOpen\(true\)\}/);
  assert.match(ui, /Criar comunidade/); // Creation remains in the existing rail card.
  const layout = read('src/components/SquareDirectoryLayout.tsx');
  assert.match(ui, /<SquareDirectoryLayout/);
  assert.match(ui, /ariaLabel="Catálogo de comunidades"/);
  assert.match(layout, /role="dialog"/);
  assert.match(layout, /aria-modal="false"/);
  assert.match(ui, /searchId="community-catalog-search"/);
  assert.match(layout, /aria-label="Filtrar por categoria"/);
  assert.match(ui, /catalogCommunities\.map\(community => renderCard\(community, 'catalog'\)\)/);
  assert.match(ui, /const selectCommunityDirectory = \(/);
  assert.match(ui, /community\.visibility !== 'private' \|\| community\.isOwner \|\| community\.isActiveMember/);
  assert.match(ui, /const visibleCommunities = useMemo\([\s\S]*?selectCommunityDirectory\(communities, listTab, searchValue, favoriteCommunityIds\)/);
  assert.match(ui, /const catalogCommunities = useMemo\([\s\S]*?selectCommunityDirectory\(communities, catalogTab, catalogSearch, favoriteCommunityIds\)/);
  assert.match(ui, /aria-label=\{catalogOpen \? "Voltar para o catálogo de comunidades" : "Voltar para a Praça"\}/);
  assert.equal((ui.match(/id="square-communities"/g) || []).length, 1, 'Keep only the canonical community rail');
  assert.doesNotMatch(ui, /community_catalog_posts|community_catalog_members|community_directory_v2/);
});

test('Square store and community filters separate participating customers from favorites', () => {
  const stores = read('src/components/tabs/SquareStoresSection.tsx');
  const social = read('src/components/tabs/KyrubTab.tsx');
  const communities = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const rules = read('firestore.rules');

  // Both rails use identical labels and retain Em alta for discovery.
  for (const file of [stores, communities]) {
    for (const label of ["'Participante'", "'Favoritos'", "'Em alta'"]) {
      assert.ok(file.includes(label), `Missing ${label} on Square rail`);
    }
    assert.doesNotMatch(file, /\['mine', 'Minhas'\]|\['discover', 'Descobrir'\]/);
  }
  assert.match(stores, /aria-pressed=\{favoriteStoreIds\.includes\(store\.id\)\}/);
  assert.match(stores, /onClick=\{\(\) => onToggleFavoriteStore\(store\.id\)\}/);
  assert.match(stores, /if \(listTab === 'participating'\)/);
  assert.match(stores, /participatingIds\.has\(store\.id\)/);
  assert.match(stores, /if \(listTab === 'favorites'\)/);
  assert.match(stores, /favoriteIds\.has\(store\.id\)/);
  assert.match(social, /onToggleFavoriteStore=\{props\.handleToggleFavoriteStore\}/);
  assert.match(social, /'viewerRole' in result\.value/);
  assert.match(social, /relationship\.level\.confirmedPurchases > 0/);
  assert.match(social, /relationship\.customerId === viewerId/);

  assert.match(communities, /if \(tab === 'participating'\) \{\s*return community\.isOwner \|\| community\.isActiveMember;/);
  assert.match(communities, /return tab !== 'favorites' \|\| favorites\.has\(community\.id\);/);
  assert.match(communities, /aria-pressed=\{favoriteCommunityIds\.has\(community\.id\)\}/);
  assert.match(communities, /onClick=\{\(\) => void toggleFavoriteCommunity\(community\.id\)\}/);
  assert.match(communities, /collection\(db, 'users', user\.uid, 'favorites'\)/);
  assert.match(communities, /kind: 'community',\s*communityId/);
  assert.match(rules, /match \/favorites\/\{favoriteId\} \{\s*allow read, write: if isSignedIn\(\) && request\.auth\.uid == userId;/);
  // Favoriting never joins a community.
  const favoriteBlock = communities.slice(communities.indexOf('const toggleFavoriteCommunity'), communities.indexOf('const selectedCommunity'));
  assert.doesNotMatch(favoriteBlock, /joinCommunity\(/);
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
  assert.match(ui, /createCommunityPost\(\{ communityId, content, mediaUrls, shareToSquare: selectedCommunity\.visibility === 'public' && shareWallToSquare \}\)/);
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
  assert.doesNotMatch(ui, /<main className="flex-1 overflow-y-auto p-4">/); // One community scroll region, no separate debate view.
});

test('reply parent reaches Firestore from both Community Mural and Praça distributed cards', () => {
  const mural = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const square = read('src/components/CommunitySquareFeedCard.tsx');
  const card = read('src/components/CommunityPostCard.tsx');
  const interactions = read('src/utils/communityPostInteractions.ts');

  // The Square adapter previously dropped the optional parent ID and silently
  // turned replies into ordinary top-level comments, despite passing all rules tests.
  assert.match(mural, /onComment=\{\(value, parentCommentId\) => addCommunityPostComment\(post, value, parentCommentId\)\}/);
  assert.match(square, /onComment=\{\(text, parentCommentId\) => addCommunityPostComment\(post, text, parentCommentId\)\}/);
  assert.match(card, /onComment\(commentDraft, replyTarget\?\.id\)/);
  assert.match(interactions, /parentCommentId \? \{ parentCommentId \} : \{\}/);
  assert.match(interactions, /parentCommentId: typeof data\.parentCommentId === 'string'/);
  assert.match(card, /orderCommentThreads\(postComments\)/);
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
  assert.match(card, /onComment\(commentDraft, replyTarget\?\.id\)/);
  assert.match(card, /Responder/);
  assert.match(card, /orderCommentThreads\(postComments\)/);
  assert.match(interactions, /parentCommentId\?: string/);
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
  for (const label of ['Visualizações', 'Curtidas', 'Salvamentos', 'Encaminhamentos', 'Comentários']) {
    assert.ok(card.includes(label), 'Métrica orgânica ausente: ' + label);
  }
  assert.match(card, /<BarChart3 className="h-4 w-4" \/> Métricas da publicação/);
  assert.match(card, /<Megaphone className="h-4 w-4"\/> Promover no Kyrub Ads/);
  assert.match(card, /entry\.intersectionRect\.height < 0\.55 \* visibleReference/);
  assert.match(card, /recordCommunityPostView\(post\)/);
  assert.match(card, /Encaminhar publicação/);
  assert.match(card, /forwardCommunityPostToSquare\(post\)/);
  assert.match(metrics, /recordCommunityPostForwardMetric/);
  assert.doesNotMatch(card, /shareCommunityPostWithMetrics/);
  assert.doesNotMatch(metrics, /navigator\.share|navigator\.clipboard/);
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
  assert.doesNotMatch(index, /authorId: user\.uid,\s*createdAt/); // Public pointer stores no author ID.
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
  assert.match(hub, /const squareRows = useMemo/);
  assert.match(hub, /communitySquareEntries/);
  assert.match(hub, /squareRows\.map\(row =>/);
  assert.match(hub, /<CommunitySquareFeedCard/);
  assert.match(hub, /subscribeCommunitySquareFeed/);
  assert.match(hub, /withinCommunitySquareWindow\(Date\.parse\(post\.createdAt/);
  assert.match(cloudUI, /OPEN_COMMUNITY_FROM_SQUARE_EVENT/);
  assert.match(rules, /match \/community_square_posts\/\{postId\}/);
  assert.match(rules, /getAfter\(\/databases\/\$\(database\)\/documents\/community_posts\/\$\(postId\)\)\.data\.createdAt == incoming\(\)\.createdAt/);
  assert.match(rules, /\.data\.visibility == 'public'/);
  assert.match(rules, /allow update: if false/);
  assert.match(cleanup, /adminDb\.collection\('community_square_posts'\)\.doc\(postId\)\.delete\(\)/);
  assert.doesNotMatch(index, /payment|mercadoPago|pitangas|wallet|checkout|sponsored/i);
});

test('community Editar is independent of personal account shortcuts and edits real community metadata', () => {
  const communityUI = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const communityCloud = read('src/utils/communityCloud.ts');
  const recovered = read('src/components/ProfileRecoveredActionsBridge.tsx');
  const polish = read('src/components/ProfileNextPolishBridge.tsx');
  const rules = read('firestore.communities.fragment.rules');

  assert.match(communityUI, /data-kyrub-community-editor="true"/);
  assert.match(communityUI, /aria-label="Fechar edição da comunidade"/);
  assert.match(communityUI, /setEditName\(selectedCommunity\.name\)/);
  assert.match(communityUI, /setEditDescription\(selectedCommunity\.description\)/);
  assert.match(communityUI, /setEditCategory\(selectedCommunity\.category\)/);
  assert.match(communityUI, /setEditLocation\(selectedCommunity\.location\)/);
  assert.match(communityUI, /Nome da comunidade/);
  assert.match(communityUI, /Descrição/);
  assert.match(communityUI, /Categoria/);
  assert.match(communityUI, /Localização \(opcional\)/);
  assert.match(communityUI, /Salvar alterações/);
  assert.match(communityUI, /name: editName/);
  assert.match(communityUI, /description: editDescription/);
  assert.match(communityUI, /category: editCategory/);
  assert.match(communityUI, /location: editLocation/);
  assert.match(communityUI, /await saveCommunityProfile\(selectedCommunity/);
  assert.match(communityCloud, /export const saveCommunityProfile = async/);
  assert.match(communityCloud, /await updateCommunity\(\{ \.\.\.input, coverImage, coverPath \}\)/);
  assert.match(communityCloud, /if \(stagedPath\)/);
  assert.match(communityCloud, /if \(community\.coverPath && community\.coverPath !== coverPath\)/);

  assert.match(recovered, /closest\('\[data-kyrub-community-editor="true"\]'\)/);
  assert.match(polish, /closest\('\[data-kyrub-community-editor="true"\]'\)/);
  assert.match(communityCloud, /\.\.\.\(input\.name !== undefined \? \{ name: trimmed\.name \} : \{\}\)/);
  assert.match(communityCloud, /\.\.\.\(input\.description !== undefined \? \{ description: trimmed\.description \} : \{\}\)/);
  assert.match(communityCloud, /\.\.\.\(input\.category !== undefined \? \{ category: trimmed\.category \} : \{\}\)/);
  assert.match(communityCloud, /\.\.\.\(input\.location !== undefined \? \{ location: trimmed\.location \} : \{\}\)/);

  const ownerRuleStart = rules.indexOf('allow update: if isSignedIn()\n        && existing().ownerId == request.auth.uid');
  const ownerRuleEnd = rules.indexOf('allow update: if isSignedIn()', ownerRuleStart + 25);
  assert.ok(ownerRuleStart > 0 && ownerRuleEnd > ownerRuleStart);
  const ownerRule = rules.slice(ownerRuleStart, ownerRuleEnd);
  for (const field of ["'name'", "'description'", "'category'", "'location'"]) {
    assert.ok(ownerRule.includes(field), `Owner-only edit allowlist excludes ${field}`);
  }
  for (const lockedField of [
    'incoming().communityId == existing().communityId',
    'incoming().ownerId == existing().ownerId',
    'incoming().visibility == existing().visibility',
    'incoming().memberCount == existing().memberCount',
  ]) {
    assert.ok(ownerRule.includes(lockedField), `Immutable community guard missing: ${lockedField}`);
  }
});

test('in-app Encaminhar uses canonical Praça references and accepted Kyrub conversations', () => {
  const card = read('src/components/CommunityPostCard.tsx');
  const forward = read('src/utils/communityPostForwarding.ts');
  const feed = read('src/utils/communitySquareFeed.ts');
  const squareUI = read('src/components/CommunitySquareFeedCard.tsx');
  const publicFeed = read('src/components/PublicSocialFeedPanel.tsx');
  const profileFeed = read('src/components/ProfileSocialHubNative.tsx');
  const chat = read('src/components/modals/ChatModal.tsx');
  const directory = read('src/utils/communityPostConnections.ts');
  const rules = read('firestore.communities.fragment.rules');
  const cleanup = read('server/communities/communityPostRemovalService.ts');

  assert.match(card, /<Forward className="h-4 w-4" \/> Encaminhar/);
  assert.match(card, /Encaminhar à Praça — 24 horas/);
  assert.match(card, /Encaminhar para um Kairubido conectado/);
  assert.match(card, /status === 'accepted'/);
  assert.match(card, /getDoc\(doc\(db, 'communities', post\.communityId\)\)/);
  assert.match(card, /setChatDraft\(composeCommunityForwardMessage\(post\)\)/);
  assert.match(card, /onMessageSent=\{text =>/);
  assert.match(chat, /await sendMessage\(sentText\)/);
  assert.match(chat, /onMessageSent\?\.\(sentText\)/);
  assert.match(chat, /Abrir publicação no Kyrub/);
  assert.match(directory, /subscribeCommunityPostConnections/);
  assert.match(forward, /community_square_forwards/);
  assert.match(forward, /runTransaction\(db/);
  assert.match(forward, /COMMUNITY_SQUARE_WINDOW_MS/);
  assert.match(forward, /forwardedAt: serverTimestamp\(\)/);
  assert.match(forward, /searchParams\.set\('community', post\.communityId\)/);
  assert.match(forward, /searchParams\.set\('post', post\.id\)/);
  assert.match(feed, /where\('forwardedAt', '>=',/);
  assert.match(feed, /forwardedByName/);
  assert.match(feed, /distributedAt/);
  assert.match(squareUI, /Encaminhado à Praça por/);
  assert.match(publicFeed, /Date\.parse\(entry\.distributedAt\)/);
  assert.match(profileFeed, /Date\.parse\(entry\.distributedAt\)/);
  assert.match(profileFeed, /OPEN_COMMUNITY_FROM_SQUARE_EVENT/);
  assert.match(read('src/components/ProfileCommunitiesCloudBridge.tsx'), /requestedSquarePostId/);
  assert.match(rules, /match \/community_square_forwards\/\{forwardId\}/);
  assert.match(rules, /duration\.value\(24, 'h'\)/);
  assert.match(rules, /data\.visibility\s*== 'public'/);
  assert.match(cleanup, /'community_square_forwards'/);
  assert.doesNotMatch(card, /navigator\.share|navigator\.clipboard|WhatsApp|whatsapp/);
  assert.doesNotMatch(forward, /payment|pix|mercadoPago|pitangas|wallet|checkout|sponsored/i);
});

test('participar uses an idempotent first-join transaction and never lists pending applicants to visitors', () => {
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const cloud = read('src/utils/communityCloud.ts');
  const rules = read('firestore.communities.fragment.rules');
  const forward = read('src/components/CommunityPostCard.tsx');

  assert.match(ui, /'Participar'/);
  assert.match(ui, /Você agora participa da comunidade/);
  assert.match(ui, /subscribeCommunityMemberships\(/);
  assert.match(ui, /viewerId: user\?\.uid/);
  assert.match(ui, /isOwner: selectedCommunity\?\.isOwner/);
  assert.match(cloud, /export const joinCommunity = async/);
  assert.match(cloud, /transaction\.get\(membershipReference\)/);
  assert.match(cloud, /if \(membershipSnapshot\.exists\(\)\)/);
  assert.match(cloud, /transaction\.set\(membershipReference/);
  assert.match(cloud, /if \(context\?\.isOwner\)/);
  assert.match(cloud, /doc\(db, 'community_members', id\)/);
  assert.match(cloud, /visible\.delete\(id\)/);
  assert.match(rules, /allow get: if isSignedIn\(\)/);
  assert.match(rules, /resource == null/);
  assert.match(rules, /membershipId\.matches\(/);
  assert.match(rules, /allow list: if isSignedIn\(\)/);
  assert.match(rules, /existing\(\)\.status == 'active'/);

  // Public forwards should not be dependent on community membership.
  assert.match(forward, /getDoc\(doc\(db, 'communities', post\.communityId\)\)/);
  assert.match(forward, /Encaminhar para um Kairubido conectado/);
  assert.doesNotMatch(forward, /forwardPublic && canParticipate/);
});

test('authenticated Praça keeps public-only communities discoverable without claiming owner permissions', () => {
  const hook = read('src/hooks/useCommunityDirectory.ts');
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(hook, /const \[publicCommunities, setPublicCommunities\]/);
  assert.match(hook, /setPublicCommunities\(cards\)/);
  assert.match(hook, /publicCommunities,/);
  assert.match(hook, /getPublicCommunityFromServer/);
  assert.match(hook, /visibility: 'public' \| 'moderated'/);
  assert.match(ui, /const publicOnlyCommunities = useMemo/);
  assert.match(ui, /const authenticatedIds = new Set\(communities\.map/);
  assert.match(ui, /publicCommunities\.filter\(community => !authenticatedIds\.has\(community\.id\)\)/);
  assert.match(ui, /catalogResultCount = catalogCommunities\.length \+ catalogPublicOnly\.length/);
  assert.match(ui, /catalogPublicOnly\.map\(community => renderPublicFallbackCard\(community, 'catalog'\)\)/);
  assert.match(ui, /visiblePublicOnly\.map\(community => renderPublicFallbackCard\(community\)\)/);
  assert.match(ui, /data-public-community-fallback=\{community\.id\}/);
  assert.match(ui, /Por segurança, participar, editar e excluir permanecem indisponíveis/);
  assert.match(ui, /tab !== 'trending'/);
  // A public card must never call the privileged community opener or update operations.
  const fallback = ui.slice(ui.indexOf('const renderPublicFallbackCard'), ui.indexOf('const pageTabs:'));
  assert.doesNotMatch(fallback, /openCommunity\(|handleMembership\(|setEditOpen\(|deleteDoc\(/);
});

test('optional community diagnostic compares live Firestore reads without writing or leaking identity', () => {
  const diagnostic = read('src/utils/communityReadDiagnostic.ts');
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(diagnostic, /getDocFromServer\(reference\)/);
  assert.match(diagnostic, /getDocFromCache\(reference\)/);
  assert.match(diagnostic, /getPublicCommunityFromServer\(communityId\)/);
  assert.match(diagnostic, /getDocsFromServer\(query\(/);
  assert.match(diagnostic, /where\('visibility', 'in', \['public', 'moderated'\]\)/);
  assert.match(diagnostic, /where\('ownerId', '==', user\.uid\)/);
  assert.doesNotMatch(diagnostic, /setDoc\(|updateDoc\(|deleteDoc\(|addDoc\(|writeBatch\(|runTransaction\(/);
  assert.doesNotMatch(diagnostic, /fetch\(|console\.|getIdToken|Authorization|localStorage/);
  assert.match(ui, /selectedPublicPreview && createPortal/);
  assert.match(ui, /Verificar leitura no meu aparelho/);
  assert.match(ui, /probePublicCommunityRead\(targetId\)/);
  assert.match(ui, /Resultado do diagnóstico de acesso/);
  assert.doesNotMatch(diagnostic, /ownerId:|email:|uid:|token:/);
});
