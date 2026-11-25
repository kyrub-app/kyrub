import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { classifyCommunityMediaInventory, parseCommunityMediaReference, summarizeCommunityMediaInventory, type InventoryEvidence, type MediaObject } from '../server/communities/communityMediaOrphanInventory';
import { selectWallDraft, resolveWallUploads } from '../src/utils/communityWallUploadRetry';
import { optimizeCommunityWallImage, readWallJpegSize, type WallJpegCodec } from '../src/utils/communityWallImageOptimization';
import { appendUniqueById } from '../src/hooks/useInfiniteCursor';

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

test('Pitangueira is personal only; community header and directories say participantes without changing counts', () => {
  const community = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const preview = read('src/components/ProfileCommunitiesPreviewBridge.tsx');
  const personal = read('src/components/tabs/PitangaAccount.tsx');
  assert.doesNotMatch(community, /SemeaduraJourneyPanel|Jornada da Pitangueira/);
  assert.match(personal, /<SemeaduraJourneyPanel/);
  assert.match(community, /selectedCommunity\.memberCount === 1 \? 'participante' : 'participantes'/);
  assert.match(community, /aria-label="Ver participantes da comunidade"/);
  assert.match(community, /onClick=\{\(\) => setMembersModalOpen\(true\)\}/);
  assert.match(community, /aria-label="Participantes da comunidade"/);
  assert.match(community, /<h3 className="text-base font-black text-white">Participantes<\/h3>/);
  assert.match(community, /community\.memberCount\.toLocaleString\('pt-BR'\)\} \{community\.memberCount === 1 \? 'participante' : 'participantes'/);
  assert.match(preview, /selectedCommunity\.memberCount === 1 \? 'participante' : 'participantes'/);
  assert.match(preview, /community\.memberCount\.toLocaleString\('pt-BR'\)\} \{community\.memberCount === 1 \? 'participante' : 'participantes'/);
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
  assert.match(ui, /uploadCommunityPostMedia\(communityId, file, attempt\)/);
  assert.match(ui, /createCommunityPost\(\{ communityId, content, mediaUrls, shareToSquare: requestedSquare,\s*allowComments, attempt: \{ postId: draft\.postId, owner \}/);
  assert.match(ui, /<CommunityPostCard/);
  assert.match(card, /<MediaCarousel mediaUrls=\{post\.mediaUrls\} \/>/);
  assert.match(ui, /text-sm text-white outline-none/);
  assert.doesNotMatch(ui, /text-\[(8|9|10)px\]/);
  assert.match(cloud, /community-post-media\/\$\{communityId\}\/\$\{user\.uid\}/);
  assert.match(storage, /match \/community-post-media\/\{communityId\}\/\{ownerId\}\/\{fileName\}/);
  assert.match(storage, /canPublishCommunityMedia\(communityId\)/);
});

test('community cover shows the complete image in a responsive header while preserving cropped thumbnails', () => {
  const cloud = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const preview = read('src/components/ProfileCommunitiesPreviewBridge.tsx');
  for (const source of [cloud, preview]) {
    assert.match(source, /displayMode\?: 'thumbnail' \| 'full'/);
    assert.match(source, /displayMode === 'full'/);
    assert.match(source, /max-h-\[55dvh\] w-auto max-w-full object-contain sm:max-h-\[28rem\]/);
    assert.match(source, /absolute inset-0 h-full w-full object-cover/);
    assert.match(source, /max-h-\[40dvh\] w-auto max-w-full object-contain/);
  }
  assert.match(cloud, /<CommunityCover community=\{selectedCommunity\} className="" displayMode="full" \/>/);
  assert.match(preview, /displayMode="full"\s+showInitial=\{false\}/);
  assert.match(cloud, /<CommunityCardBackdrop coverImage=\{community\.coverImage\} \/>/);
  assert.match(preview, /<CommunityCardBackdrop coverImage=\{community\.coverImage\} \/>/);
});

test('community cards use cover photo across the full card with readable actions and badge on upper left', () => {
  const cloud = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const preview = read('src/components/ProfileCommunitiesPreviewBridge.tsx');
  const guest = read('src/components/GuestSquarePanel.tsx');
  const background = read('src/components/CommunityCardBackdrop.tsx');
  for (const source of [cloud, preview, guest]) {
    assert.match(source, /<CommunityCardBackdrop coverImage=\{community\.coverImage\} \/>/);
    assert.match(source, /relative isolate flex min-h-\[3(?:10|20)px\]/);
    assert.match(source, /relative z-10/);
    assert.match(source, /line-clamp-2/);
  }
  assert.match(background, /pointer-events-none absolute inset-0 overflow-hidden/);
  assert.match(background, /absolute inset-0 h-full w-full object-cover/);
  assert.match(background, /from-slate-950\/95 via-slate-950\/65 to-slate-950\/25/);
  assert.match(background, /loading="lazy"/);
  assert.match(cloud, /absolute left-2 top-2 z-20/);
  assert.match(preview, /absolute left-2 top-2 z-20/);
  assert.match(cloud, /absolute right-2 top-2 z-20/);
  assert.match(cloud, /aria-pressed=\{favoriteCommunityIds\.has\(community\.id\)\}/);
  assert.match(cloud, /onClick=\{\(\) => void toggleFavoriteCommunity\(community\.id\)\}/);
  assert.match(cloud, /layout === 'catalog' \? 'min-w-0 w-full' : 'w-\[206px\] shrink-0'/);
  assert.match(cloud, /data-public-community-fallback=\{community\.id\}/);
  assert.match(cloud, /onClick=\{\(\) => \{ setPublicProbe\(null\); setSelectedPublicPreview\(community\); \}\}/);
  assert.match(guest, /setSelectedCommunity\(community\)/);
  assert.match(guest, /requireLogin\('participar da comunidade ' \+ community\.name\)/);
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

test('community author controls comments and one pinned comment in both mural and Praça', () => {
  const composer = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const api = read('src/utils/communityCloud.ts');
  const actions = read('src/utils/communityPostInteractions.ts');
  const card = read('src/components/CommunityPostCard.tsx');
  const square = read('src/components/CommunitySquareFeedCard.tsx');
  const projection = read('src/utils/communitySquareFeed.ts');
  const rules = read('firestore.communities.fragment.rules');
  assert.match(composer, /const \[wallAllowComments, setWallAllowComments\] = useState\(true\)/);
  assert.match(composer, /aria-label="Permitir comentários nesta publicação"/);
  assert.match(composer, /const \[content, requestedSquare, allowComments\] = pending/);
  assert.match(composer, /shareWallToSquare, wallAllowComments\] as \[string, boolean, boolean\]/);
  assert.match(composer, /allowComments, attempt: \{ postId: draft\.postId, owner \}/);
  assert.match(api, /allowComments: input\.allowComments !== false/);
  assert.match(api, /pinnedCommentId: ''/);
  assert.match(api, /allowComments: data\.allowComments !== false/);
  assert.match(projection, /allowComments: source\.allowComments !== false/);
  assert.match(projection, /pinnedCommentId: read\(source\.pinnedCommentId\)/);
  assert.match(actions, /setCommunityPostPinnedComment/);
  assert.match(actions, /currentPost\.data\(\)\.allowComments === false/);
  assert.match(card, /post\.allowComments === false \? 'Comentários' : 'Comentar'/);
  assert.match(card, /post\.allowComments !== false && canParticipate/);
  assert.match(card, /Fixado pelo autor/);
  assert.match(card, /onPinComment\(comment\.id\)/);
  assert.match(card, /onPinComment\(''\)/);
  assert.match(composer, /onPinComment=\{commentId => setCommunityPostPinnedComment\(post, commentId\)\}/);
  assert.match(square, /onPinComment=\{commentId => setCommunityPostPinnedComment\(post, commentId\)\}/);
  assert.match(rules, /data\.get\('allowComments', true\) == true/);
  assert.match(rules, /incoming\(\)\.pinnedCommentId == ''/);
  assert.match(rules, /community_post_comments\/\$\(incoming\(\)\.pinnedCommentId\)/);
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
  assert.match(card, /orderCommentThreads\(displayComments\)/);
});

test('community post actions are text-only and recent comments reuse canonical live data', () => {
  const card = read('src/components/CommunityPostCard.tsx');
  const square = read('src/components/CommunitySquareFeedCard.tsx');
  const semear = read('src/components/SemearButton.tsx');
  const interactions = read('src/utils/communityPostInteractions.ts');
  assert.match(card, /<SemearButton kind="community" postId=\{post\.id\} viewerId=\{viewerId\} compact/);
  assert.match(semear, /!compact && \(state\?\.closed/);
  assert.match(semear, /compact\s*\? compactLabel/);
  assert.match(card, /\{isLiked \? 'Curtido' : 'Curtir'\}/);
  assert.match(card, /\{saved \? 'Salvo' : 'Salvar'\}/);
  assert.doesNotMatch(card, /Comentar · \{postComments\.length\}/);
  assert.match(card, /<button type="button" aria-expanded=\{commentsOpen\}/);
  assert.match(card, /selectRecentComments\(\s*postComments\.filter/);
  assert.match(card, /Comentários recentes da publicação/);
  assert.match(card, /previewComments\.map\(comment =>/);
  assert.match(card, /postComments\.length > previewComments\.length \+ \(pinnedDisplayComment \? 1 : 0\)/);
  assert.match(card, /Ver mais comentários/);
  assert.match(card, /onClick=\{\(\) => setCommentsOpen\(true\)\}/);
  assert.match(card, /onComment\(commentDraft, replyTarget\?\.id\)/);
  assert.match(square, /<CommunityPostCard/);
  assert.match(interactions, /where\('communityId', '==', communityId\)/);
  assert.doesNotMatch(card, /subscribeCommunityPostInteractions\(/);
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
  assert.match(card, /orderCommentThreads\(displayComments\)/);
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
  assert.match(cloudUI, /selectedCommunity\.visibility === 'public' && shareWallToSquare/);
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
  assert.match(card, /setChatDraft\(composeCommunityForwardMessage\(displayPost\)\)/);
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

test('read-only community diagnostic compares client Firebase identity without exposing values', () => {
  const probe = read('src/utils/communityReadDiagnostic.ts');
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(probe, /auth\.app\.options\.projectId/);
  assert.match(probe, /db\.app\.options\.projectId/);
  assert.match(probe, /auth\.app\.name === db\.app\.name/);
  assert.match(probe, /getApps\(\)\.length === 1/);
  assert.match(probe, /_databaseId\?\.database/);
  assert.match(probe, /_databaseId\?\.projectId/);
  assert.match(probe, /_settings\?\.host/);
  assert.match(probe, /'projeto esperado'/);
  assert.match(probe, /'projeto divergente'/);
  assert.match(ui, /Projeto Firebase:<\/strong>/);
  assert.match(ui, /Banco Firestore:<\/strong>/);
  assert.match(ui, /Servidor Firestore:<\/strong>/);
  assert.doesNotMatch(probe, /setDoc\(|updateDoc\(|deleteDoc\(|getIdToken\(|console\.|fetch\(/);
  assert.doesNotMatch(ui, /publicProbe\.uid|publicProbe\.token|publicProbe\.projectId/);
});

test('one-shot authenticated Firestore REST comparison never logs or forwards the session token', () => {
  const rest = read('src/utils/communityRestReadProbe.ts');
  const diagnostic = read('src/utils/communityReadDiagnostic.ts');
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(rest, /user\.getIdToken\(\)/);
  assert.match(rest, /https:\/\/firestore\.googleapis\.com\/v1\//);
  assert.match(rest, /\?mask\.fieldPaths=name/);
  assert.match(rest, /method: 'GET'/);
  assert.match(rest, /redirect: 'error'/);
  assert.match(rest, /referrerPolicy: 'no-referrer'/);
  assert.match(rest, /cache: 'no-store'/);
  assert.match(rest, /Authorization: 'Bearer ' \+ idToken/);
  assert.match(rest, /body\?\.name === resource/);
  assert.doesNotMatch(rest, /console\.|localStorage|sessionStorage|POST|setDoc\(|updateDoc\(|deleteDoc\(/);
  assert.doesNotMatch(rest, /fetch\('\/api\//);
  assert.match(diagnostic, /probeCommunityGoogleRest\(user, communityId\)/);
  assert.match(ui, /REST Google autenticada:<\/strong>/);
  assert.doesNotMatch(ui, /publicProbe\.token|publicProbe\.uid|publicProbe\.resource/);
});

test('Firestore Lite no-cache diagnostic distinguishes local overlays from server results', () => {
  const diagnostic = read('src/utils/communityReadDiagnostic.ts');
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(diagnostic, /from 'firebase\/firestore\/lite'/);
  assert.match(diagnostic, /import \{ auth, db, liteDb \} from '\.\/firebase'/);
  assert.match(diagnostic, /getLiteDoc\(liteDoc\(liteDb, 'communities', communityId\)\)/);
  assert.match(diagnostic, /snapshot\.metadata\.fromCache/);
  assert.match(diagnostic, /snapshot\.metadata\.hasPendingWrites/);
  assert.match(diagnostic, /publicSnapshot\.metadata\.fromCache/);
  assert.match(diagnostic, /publicSnapshot\.metadata\.hasPendingWrites/);
  assert.match(ui, /Firestore Lite \(sem cache persistente\):<\/strong>/);
  assert.match(ui, /Origem do snapshot SDK:<\/strong>/);
  assert.match(ui, /Gravação local pendente:<\/strong>/);
  assert.match(ui, /Origem da consulta geral:<\/strong>/);
  assert.doesNotMatch(diagnostic, /deleteDoc\(|setDoc\(|updateDoc\(|clearIndexedDbPersistence\(|terminate\(|enableNetwork\(|disableNetwork\(/);
  assert.doesNotMatch(ui, /publicProbe\.ownerId|publicProbe\.uid|publicProbe\.token/);
});

test('public community reconciliation uses the same authenticated Lite read that recovered legacy records', () => {
  const hook = read('src/hooks/useCommunityDirectory.ts');
  const cloud = read('src/utils/communityCloud.ts');
  const view = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const start = cloud.indexOf('export const getPublicCommunityFromServer = async (');
  const end = cloud.indexOf('const createCommunityWithId', start);
  assert.ok(start > 0 && end > start, 'public reconciliation function exists');
  const readThrough = cloud.slice(start, end);
  assert.match(cloud, /from 'firebase\/firestore\/lite'/);
  assert.match(cloud, /import \{ auth, db, liteDb, storage \} from '\.\/firebase'/);
  assert.match(readThrough, /getLiteDoc\(liteDoc\(liteDb, 'communities', communityId\)\)/);
  assert.doesNotMatch(readThrough, /getDocFromServer|db\.|writeBatch|updateDoc|deleteDoc|setDoc/);
  assert.match(readThrough, /data\.visibility !== 'public' && data\.visibility !== 'moderated'/);
  assert.match(readThrough, /mapCommunity\(snapshot\.id, data\)/);
  assert.match(hook, /ids\.map\(id => getPublicCommunityFromServer\(id\)\)/);
  assert.match(hook, /publicReconciled,/);
  assert.match(view, /publicCommunities\.filter\(community => !authenticatedIds\.has\(community\.id\)\)/);
  assert.doesNotMatch(readThrough, /localStorage|clearIndexedDbPersistence|disableNetwork|enableNetwork/);
});

test('future communities remain visible after commit and fresh login without a duplicate catalogue', () => {
  const cloud = read('src/utils/communityCloud.ts');
  const directory = read('src/hooks/useCommunityDirectory.ts');
  const view = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(cloud, /const batch = writeBatch\(db\)/);
  assert.match(cloud, /await batch\.commit\(\)/);
  assert.match(cloud, /getOwnedCommunitiesFromServer = async/);
  assert.match(cloud, /getLiteDocs\(liteQuery\(/);
  assert.match(cloud, /liteWhere\('ownerId', '==', user\.uid\)/);
  assert.match(cloud, /if \(auth\.currentUser\?\.uid !== user\.uid\)/);
  assert.match(cloud, /mapped\.ownerId === user\.uid/);
  const getOwned = cloud.slice(cloud.indexOf('export const getOwnedCommunitiesFromServer'), cloud.indexOf('const createCommunityWithId'));
  assert.doesNotMatch(getOwned, /setDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(|clearIndexedDbPersistence\(/);
  assert.match(directory, /registerCommittedCommunity = useCallback/);
  assert.match(directory, /auth\.currentUser\.uid !== community\.ownerId/);
  assert.match(directory, /setCommittedCreated\(previous =>/);
  assert.match(directory, /setOwnedReconciled\(values\)/);
  assert.match(directory, /window\.addEventListener\('focus', onFocus\)/);
  assert.match(directory, /window\.setInterval\(onFocus, 5 \* 60 \* 1000\)/);
  assert.match(directory, /setCommittedCreated\(\[\]\)/);
  assert.match(directory, /setOwnedReconciled\(\[\]\)/);
  assert.match(directory, /committedCreated,\s*ownedReconciled,\s*publicReconciled,\s*discoverable,\s*owned,\s*privateMembershipCommunities/);
  const submit = view.slice(view.indexOf('const submitCreate = async'), view.indexOf('const openEditor =', view.indexOf('const submitCreate = async')));
  assert.match(submit, /const community = await createCommunity\(createDraft\)/);
  assert.match(submit, /registerCommittedCommunity\(community\)/);
  assert.ok(submit.indexOf('await createCommunity(createDraft)') < submit.indexOf('registerCommittedCommunity(community)'));
  assert.match(view, /if \(createInFlightRef\.current\) return/);
  assert.match(view, /createInFlightRef\.current = false/);
  assert.doesNotMatch(directory, /deleteDoc\(|updateDoc\(|writeBatch\(|clearIndexedDbPersistence\(/);
});

test('continuous cursor pages append unique cards and preserve their original order', () => {
  const old = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  assert.deepEqual(appendUniqueById(old, [
    { id: 'b', name: 'stale' }, { id: 'c', name: 'C' },
    { id: 'c', name: 'duplicate' }, { id: 'd', name: 'D' },
  ]), [
    { id: 'a', name: 'A' }, { id: 'b', name: 'B' },
    { id: 'c', name: 'C' }, { id: 'd', name: 'D' },
  ]);
});

test('both community catalogs use one scroll mechanism and bounded cursor batches', () => {
  const guest = read('src/components/GuestSquarePanel.tsx');
  const owner = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const cloud = read('src/utils/communityCloud.ts');
  const service = read('server/marketplace/publicCommunityPageService.ts');
  const shared = read('src/hooks/useInfiniteCursor.ts');
  const trigger = read('src/components/InfiniteScrollTrigger.tsx');
  const layout = read('src/components/SquareDirectoryLayout.tsx');
  const api = read('api/health.ts');
  const vercel = read('vercel.json');
  assert.match(guest, /useInfiniteCursor\(communityCatalogOpen/);
  assert.match(owner, /useInfiniteCursor\(/);
  assert.match(guest, /<InfiniteScrollTrigger/);
  assert.match(owner, /<InfiniteScrollTrigger/);
  assert.match(guest, /\/api\/square\/communities\?/);
  assert.match(owner, /listPublicCommunityPageLite\(cursor\)/);
  assert.match(service, /\.limit\(PUBLIC_COMMUNITY_PAGE_SIZE \+ 1\)/);
  assert.match(service, /\.where\('visibility', 'in', \['public', 'moderated'\]\)/);
  assert.match(service, /orderBy\('__name__'\)/);
  assert.match(cloud, /liteOrderBy\(liteDocumentId\(\)\)/);
  assert.match(cloud, /liteLimit\(21\)/);
  assert.match(cloud, /limit\(24\)/);
  assert.match(shared, /version !== versionRef\.current/);
  assert.match(shared, /controllerRef\.current\?\.abort\(\)/);
  assert.match(shared, /appendUniqueById/);
  assert.match(trigger, /IntersectionObserver/);
  assert.match(trigger, /rootMargin: '280px 0px'/);
  assert.match(layout, /data-square-directory-scroll/);
  assert.match(api, /transport === 'public-community-page'/);
  assert.match(vercel, /"source": "\/api\/square\/communities"/);
  assert.doesNotMatch(service, /ownerId:|authorEmail:|userId:|\.update\(|\.delete\(/);
  assert.doesNotMatch(guest, /\bsetDoc\(|\bupdateDoc\(|\bdeleteDoc\(/);
});

test('Praça store and community catalogs scroll their titles, filters and cards in the same region', () => {
  const layout = read('src/components/SquareDirectoryLayout.tsx');
  const stores = read('src/components/tabs/SquareStoresSection.tsx');
  const guest = read('src/components/GuestSquarePanel.tsx');
  const owner = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const trigger = read('src/components/InfiniteScrollTrigger.tsx');
  const scrollStart = layout.indexOf('<main data-square-directory-scroll="true"');
  const scrollEnd = layout.indexOf('</main>', scrollStart);
  assert.ok(scrollStart >= 0 && scrollEnd > scrollStart, 'One scroll root must contain the full catalog');
  const scrollContent = layout.slice(scrollStart, scrollEnd);
  const titleAt = scrollContent.indexOf('<header');
  const searchAt = scrollContent.indexOf('htmlFor={searchId}');
  const filtersAt = scrollContent.indexOf('aria-label={`Filtros de');
  const cardsAt = scrollContent.indexOf('{children}');
  assert.ok(titleAt >= 0 && titleAt < searchAt && searchAt < filtersAt && filtersAt < cardsAt,
    'Title, search, filters and cards must scroll together');
  assert.match(scrollContent, /aria-label="Voltar à Praça"/);
  assert.match(scrollContent, /aria-label="Filtrar por categoria"/);
  assert.doesNotMatch(layout.slice(0, scrollStart), /<header|htmlFor=\{searchId\}/,
    'No sticky catalog controls outside the scroll root');
  assert.match(layout, /document\.getElementById\('app-header'\)/);
  assert.match(layout, /style=\{\{ top: headerBottom \}\}/);
  assert.match(stores, /<SquareDirectoryLayout/);
  assert.match(guest, /<SquareDirectoryLayout/);
  assert.match(owner, /<SquareDirectoryLayout/);
  assert.match(trigger, /closest\('\[data-square-directory-scroll\]'\)/);
});

test('typography in Praça portals follows the Catu/Renda baseline without double enlargement', () => {
  const fontHook = read('src/hooks/useFontSizeAccessibility.ts');
  const renda = read('src/components/tabs/RendaTab.tsx');
  const notifications = read('src/components/UserNotificationCenterBridge.tsx');
  const community = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  const directory = read('src/components/SquareDirectoryLayout.tsx');
  const profile = read('src/components/modals/UserProfileModal.tsx');

  // Catu establishes a 10px source body / 12px source title, which receives
  // the existing +4px increase only once (14px / 16px displayed).
  assert.match(renda, /<p className="text-\[10px\] leading-relaxed text-slate-400">/);
  assert.match(renda, /<h3 className="text-xs font-black uppercase/);
  assert.match(fontHook, /ACCESSIBILITY_FONT_INCREASE_PX = 4/);
  assert.match(fontHook, /PORTAL_TYPOGRAPHY_SELECTOR/);
  assert.match(fontHook, /rootElement\.contains\(element\) \|\| Boolean\(element\.closest\(PORTAL_TYPOGRAPHY_SELECTOR\)\)/);
  assert.match(fontHook, /observer\.observe\(document\.body,/);
  assert.match(fontHook, /adjustedElements\.has\(element\)/);
  assert.match(fontHook, /!element\.closest\(SPECIALIZED_TYPOGRAPHY_SELECTOR\)/);
  assert.match(fontHook, /temporarilyRestoreAdjustedAncestors/);
  assert.doesNotMatch(fontHook, /document\.body\.style\.fontSize\s*=/);

  // Only owned app portals opt in: ERP/admin and unrelated widgets do not.
  assert.match(notifications, /data-kyrub-font-scope="true" className="fixed inset-0 z-\[215\]/);
  assert.equal((community.match(/data-kyrub-font-scope="true"/g) || []).length, 6);
  assert.match(directory, /data-kyrub-font-scope="true"/);
  assert.match(directory, /data-square-directory-scroll="true"/);

  // The modal bridge already has its own typography scale: do not add +4px
  // to it again through the root observer.
  assert.match(profile, /data-kyrub-font-managed="true"/);
  // Personal center had 14px source descriptions; normalize them to Catu's
  // body baseline while retaining heading/card-label hierarchy.
  assert.match(profile, /<h3 className="text-xs font-black text-white">Carteira Kairube<\/h3>/);
  assert.match(profile, /<p className="mt-1 text-\[10px\] leading-relaxed text-slate-400">/);
  assert.match(profile, /<strong className="mt-2 block text-xs font-bold text-slate-100">\{card\.label\}<\/strong>/);
  assert.match(profile, /<span className="mt-1 block text-\[10px\] leading-relaxed text-slate-400">\{card\.description\}<\/span>/);
});


test('340px community catalog keeps Conhecer and Participar labels complete', () => {
  const guest = read('src/components/GuestSquarePanel.tsx');
  const member = read('src/components/ProfileCommunitiesCloudBridge.tsx');

  // Each mobile catalog card already shares half of a two-column grid:
  // stacking its two actions prevents another 50/50 split inside the card.
  assert.match(guest, /catalog \? 'grid-cols-1' : 'grid-cols-2'/);
  assert.match(guest, /min-h-11 min-w-0 rounded-xl border border-slate-700/);
  assert.match(guest, /leading-tight whitespace-normal break-words/);
  assert.match(guest, /Conhecer[\s\S]*?Participar/);
  // Membership/fallback actions are also allowed to wrap, not clip.
  assert.match(member, /min-h-11 min-w-0 w-full items-center justify-center rounded-xl border border-white\/15 px-2 text-center text-xs font-black uppercase leading-tight whitespace-normal break-words/);
  assert.match(member, /min-h-11 min-w-0 w-full items-center justify-center rounded-xl border border-white\/15 bg-slate-900\/90 px-2 text-center/);
});

const wallJpegFixture = (width = 4000, height = 3000, size = 1024 * 1024) => {
  const bytes = new Uint8Array(size);
  // Synthetic SOF header; codec is mocked, not a real encoded photo.
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0]);
  return new Blob([bytes], { type: 'image/jpeg' });
};

test('wall JPEG optimizer preserves oriented aspect and closes bitmap, returning smaller JPEG', async () => {
  const source = wallJpegFixture();
  let closed = 0;
  let target: {width: number; height: number} | undefined;
  const output = new Blob([new Uint8Array(200 * 1024)], { type: 'image/jpeg' });
  const codec: WallJpegCodec = {
    async decode() { return { width: 3000, height: 4000, close() { closed++; } }; },
    async encode(_image, size) { target = size; return output; },
  };
  assert.deepEqual(readWallJpegSize(new Uint8Array(await source.arrayBuffer())), {width: 4000, height: 3000});
  assert.equal(await optimizeCommunityWallImage(source, codec), output);
  assert.deepEqual(target, {width: 1350, height: 1800});
  assert.equal(closed, 1);
});

test('wall optimizer skips small files, non-JPEG, malformed and oversized pixel dimensions before decode', async () => {
  let calls = 0;
  const codec: WallJpegCodec = {
    async decode() { calls++; throw Error('unexpected decode'); },
    async encode() { return null; },
  };
  const bytes = new Uint8Array(1024 * 1024);
  for (const file of [
    wallJpegFixture(100, 100, 1000),
    wallJpegFixture(9000, 9000),
    new Blob([bytes], {type: 'image/jpeg'}),
    new Blob([bytes], {type: 'image/png'}),
    new Blob([bytes], {type: 'image/webp'}),
    new Blob([bytes], {type: 'video/mp4'}),
  ]) assert.equal(await optimizeCommunityWallImage(file, codec), file);
  assert.equal(calls, 0);
});

test('wall optimizer falls back without increasing bytes and releases bitmap on encoder failure', async () => {
  const source = wallJpegFixture();
  let closed = 0;
  const outputs = [null, new Blob([], {type: 'image/jpeg'}), new Blob([new Uint8Array(source.size)], {type: 'image/jpeg'}), new Blob([new Uint8Array(100)], {type: 'image/png'})];
  for (const output of outputs) {
    assert.equal(await optimizeCommunityWallImage(source, {
      async decode() { return {width: 800, height: 600, close() { closed++; }}; },
      async encode(_image, size) { assert.deepEqual(size, {width: 800, height: 600}); return output; },
    }), source);
  }
  assert.equal(await optimizeCommunityWallImage(source, {
    async decode() { return {width: 800, height: 600, close() { closed++; }}; },
    async encode() { throw Error('codec unavailable'); },
  }), source);
  assert.equal(closed, outputs.length + 1);
});

test('wall upload keeps original validation and uploads optimized blob with same scoped metadata', () => {
  const cloud = read('src/utils/communityCloud.ts');
  assert.match(cloud, /await optimizeCommunityWallImage\(file\)/);
  assert.match(cloud, /uploadBytes\(destination, uploadFile, \{/);
  assert.match(cloud, /customMetadata: \{ communityId, ownerId: user.uid, purpose: 'community-wall' \}/);
});

test('wall draft retains attachment and post IDs on partial failure and commit retry, not across changed scope', async () => {
  const owner = {}, files = [{}, {}, {}];
  let id = 0;
  const newId = () => String(++id);
  const draft = selectWallDraft(null, owner, 'community', 'text', files, newId);
  const stored = new Map<string, string>();
  const writes: string[] = [];
  let fail = true;
  const upload = async (_: object, attempt: {id:string; started:boolean}) => {
    if (stored.has(attempt.id)) return stored.get(attempt.id)!;
    attempt.started = true;
    const url = 'url-' + attempt.id;
    stored.set(attempt.id, url);
    writes.push(attempt.id);
    if (fail && attempt.id === '2') throw Error('response lost after upload');
    return url;
  };
  await assert.rejects(resolveWallUploads(draft, () => {}, upload), /response lost/);
  fail = false;
  const retry = selectWallDraft(draft, owner, 'community', 'text', files, newId);
  assert.equal(retry, draft);
  assert.deepEqual(await resolveWallUploads(retry, () => {}, upload), ['url-1','url-2','url-3']);
  assert.deepEqual(writes, ['1','2','3']);
  assert.notEqual(selectWallDraft(draft, {}, 'community', 'text', files, newId), draft);
  assert.notEqual(selectWallDraft(draft, owner, 'other', 'text', files, newId), draft);
  assert.notEqual(selectWallDraft(draft, owner, 'community', 'edited', files, newId), draft);
  assert.notEqual(selectWallDraft(draft, owner, 'community', 'text', [...files].reverse(), newId), draft);
  draft.commitStarted = true;
  const retryCommit = selectWallDraft(draft, owner, 'community', 'text', files, newId);
  assert.equal(retryCommit, draft);
  assert.equal(retryCommit.postId, draft.postId);
  assert.deepEqual(await resolveWallUploads(retryCommit, () => {}, async () => {
    throw Error('unexpected upload after commit');
  }), ['url-1','url-2','url-3']);
  assert.throws(() => selectWallDraft(draft, owner, 'community', 'edited', files, newId), /anterior/);
  assert.notEqual(selectWallDraft(draft, {}, 'community', 'text', files, newId).postId, draft.postId);
});

test('wall retry aborts when the draft scope changes mid-upload', async () => {
  const draft = selectWallDraft(null, {}, 'community', 'text', [1,2], () => 'id');
  let current = true, calls = 0;
  await assert.rejects(resolveWallUploads(draft, () => {
    if (!current) throw Error('scope changed');
  }, async () => { calls++; current = false; return 'url'; }), /scope changed/);
  assert.equal(calls, 1);
});

test('wall retry consults scoped metadata and only object-not-found permits a new upload', () => {
  const cloud = read('src/utils/communityCloud.ts');
  const ui = read('src/components/ProfileCommunitiesCloudBridge.tsx');
  assert.match(cloud, /getMetadata\(destination\)/);
  assert.match(cloud, /storage\/object-not-found/);
  assert.match(cloud, /metadata\.customMetadata\?\.ownerId !== user\.uid/);
  assert.match(ui, /draft\.commitStarted = true;\s*setWallCommitPending\(true\);\s*await createCommunityPost/);
  assert.match(ui, /wallSubmitLock\.current = true/);
});

test('wall publication transaction uses immutable receipt before writing source or Praça pointer', () => {
  const cloud = read('src/utils/communityCloud.ts');
  const rules = read('firestore.communities.fragment.rules');
  const branch = cloud.slice(cloud.indexOf('const attempt = input.attempt;'), cloud.indexOf("const reference = doc(collection(db, 'community_posts'));", cloud.indexOf('const attempt = input.attempt;')));
  assert.match(branch, /tx\.get\(receiptRef\)/);
  assert.ok(branch.indexOf('return attempt.postId;') < branch.indexOf('tx.set(postRef'));
  assert.match(branch, /tx\.set\(receiptRef/);
  assert.match(branch, /data\.requestHash !== requestHash/);
  assert.match(rules, /match \/community_wall_publish_receipts\/\{postId\}/);
  assert.match(rules, /!isWallReceiptPostId\(postId\) \|\| hasNewWallPublishReceipt\(postId\)/);
});

test('offline media inventory normalizes tokens and rejects other buckets or malformed paths', () => {
  const bucket = 'demo-kyrub.example';
  const name = 'community-post-media/community/owner/image-12345678-1234-1234-1234-123456789abc.jpg';
  const url = 'https://firebasestorage.googleapis.com/v0/b/' + bucket + '/o/' + encodeURIComponent(name);
  assert.deepEqual(parseCommunityMediaReference(url + '?alt=media&token=one', bucket), {bucket, name});
  assert.deepEqual(parseCommunityMediaReference(url + '?alt=media&token=two', bucket), {bucket, name});
  assert.equal(parseCommunityMediaReference(url, 'different'), null);
  assert.equal(parseCommunityMediaReference(url.replace('googleapis.com', 'googleapis.com.example'), bucket), null);
  assert.equal(parseCommunityMediaReference(url + '%2Fnested', bucket), null);
  assert.equal(parseCommunityMediaReference(url.replace(encodeURIComponent(name), '%ZZ'), bucket), null);
});

test('orphan inventory fails closed with incomplete evidence and protects live, pending and recent media', () => {
  const bucket = 'demo-kyrub.example', now = 2_000_000_000_000;
  const make = (index: number, age: number): MediaObject => ({
    bucket, name: 'community-post-media/community/owner/image-12345678-1234-1234-1234-123456789ab' + index + '.jpg',
    generation: '123', sizeBytes: 100, createdAtMs: now - age * 86400000,
  });
  const objects = [make(1, 30), make(2, 30), make(3, 1), make(4, 30)];
  const evidence: InventoryEvidence = {
    bucket, observedAtMs: now, objectsComplete: true, referencesComplete: true, writersQuiesced: true,
    references: [objects[0]], pending: [objects[1]],
  };
  const classify = (e: InventoryEvidence) => classifyCommunityMediaInventory(objects, e).map(x => x.status);
  assert.deepEqual(classify(evidence), ['referenced','pending','recent','review_candidate']);
  for (const flag of ['objectsComplete','referencesComplete','writersQuiesced'] as const)
    assert.deepEqual(classify({...evidence, [flag]: false}), ['referenced','pending','recent','unknown']);
  const summary = summarizeCommunityMediaInventory(classifyCommunityMediaInventory(objects, evidence));
  assert.deepEqual(summary.review_candidate, {count:1, bytes:100});
  assert.equal(classifyCommunityMediaInventory([objects[3],objects[3]], evidence)[0].status, 'unknown');
  assert.equal(classifyCommunityMediaInventory([{...objects[3], generation:''}], evidence)[0].status, 'unknown');
  assert.equal(classifyCommunityMediaInventory([{...objects[3], bucket:'other'}], evidence)[0].status, 'unknown');
});
