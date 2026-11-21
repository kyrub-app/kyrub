import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { projectPublicDeliveryOpportunity } from '../shared/publicDeliveryDiscovery';
import {
  projectPublicSquareStore,
  projectPublicSquareCommunity,
  projectPublicSquareSocialPost,
  projectPublicSquareCommunityPost,
} from '../server/marketplace/publicSquareDiscoveryService';
import { PUBLIC_COMMUNITY_PAGE_SIZE, parsePublicCommunityCursor } from '../server/marketplace/publicCommunityPageService';

const app = readFileSync('src/App.tsx', 'utf8');
const guest = readFileSync('src/components/KyrubGuestWorkspace.tsx', 'utf8');
const renda = readFileSync('src/components/tabs/RendaTab.tsx', 'utf8');
const rules = readFileSync('firestore.rules', 'utf8');
const api = readFileSync('api/health.ts', 'utf8');
const vercel = readFileSync('vercel.json', 'utf8');

test('root selects the real Kyrub workspace for signed and guest visitors, landing retained explicitly', () => {
  assert.match(app, /return <KyrubMainEntry \/>/);
  assert.match(app, /return currentUser\s*\?\s*<AuthenticatedKyrubApp operational=\{false\} \/>\s*:\s*<KyrubGuestWorkspace \/>/);
  assert.match(app, /entry === 'welcome'/);
  assert.match(app, /return <KyrubRendaEntryApp \/>/);
  assert.doesNotMatch(app, /entry === null \|\| entry === 'renda'/);
});

test('guest can open real Renda cards without creating a store, booking delivery or granting rewards', () => {
  assert.match(guest, /<RendaTab[\s\S]*guestReadOnly/);
  assert.match(guest, /setShowDeliveryModal=\{\(\) => requestLogin/);
  assert.match(guest, /onGuestBrowseDeliveries=\{\(\) => openPanel\('deliveries'\)\}/);
  assert.match(renda, /if \(guestReadOnly\) \{\s*onGuestLoginRequired/);
  assert.match(guest, /Aceitar entrega/);
  assert.match(guest, /requestLogin\('aceitar uma entrega'\)/);
  assert.doesNotMatch(guest, /updateDoc|setDoc|deleteDoc|runTransaction|acceptDeliveryOpportunity/);
});

test('public deliveries expose no private details even if present in Firestore source', () => {
  const full = {
    source: 'kyrub-order', status: 'available', acceptedBy: '',
    from: 'Rua Privada 123', to: 'Rua Secreta 456',
    buyerId: 'buyer_private', buyerEmail: 'private@example.test',
    customerPhone: '1111111111', payment: 19.95,
    preciseGps: { latitude: -23, longitude: -46 },
  };
  const projected = projectPublicDeliveryOpportunity('order_safe123', full);
  assert.deepEqual(projected, {
    id: 'order_safe123', label: 'Entrega Kyrub disponível',
  });
  const serialized = JSON.stringify(projected);
  for (const secret of ['Rua Privada', 'Rua Secreta', 'buyer_private', 'private@example.test', '19.95', 'latitude']) {
    assert.equal(serialized.includes(secret), false);
  }
  assert.equal(projectPublicDeliveryOpportunity('manual', { ...full, source: 'manual' }), null);
  assert.equal(projectPublicDeliveryOpportunity('already', { ...full, status: 'accepted' }), null);
  assert.equal(projectPublicDeliveryOpportunity('assigned', { ...full, acceptedBy: 'uid123' }), null);
  assert.equal(projectPublicDeliveryOpportunity('bad/path', full), null);
});

test('public read uses server-side API without weakening private Firestore rules', () => {
  assert.match(api, /transport === 'public-delivery-discovery'/);
  assert.match(vercel, /"source": "\/api\/delivery-opportunities\/public"/);
  assert.match(rules, /match \/hub\/renda\/deliveries\/\{deliveryId\}/);
  assert.match(rules, /allow read: if isSignedIn\(\);/);
});

test('Praça visitor uses the real three-section directory rather than a hardcoded official-store landing', () => {
  const square = readFileSync('src/components/GuestSquarePanel.tsx', 'utf8');
  const service = readFileSync('server/marketplace/publicSquareDiscoveryService.ts', 'utf8');
  assert.match(guest, /<GuestSquarePanel onLoginRequired=\{requestLogin\}/);
  assert.match(guest, /id="kyrub-workspace-main"/);
  assert.doesNotMatch(guest, /Explore lojas e ofertas/);
  assert.match(square, /<SquareStoresSection/);
  assert.match(square, /id="square-communities"/);
  assert.match(square, /id="guest-square-wall"/);
  assert.match(square, /<SquareDirectoryLayout/);
  assert.match(square, /onToggleFavoriteStore=\{\(\) => requireLogin/);
  assert.match(square, /onClick=\{\(\) => requireLogin\('comentar uma publicação'\)\}/);
  assert.match(service, /adminDb\.collection\('social_posts'\)\.where\('visibility', '==', 'public'\)/);
  assert.match(api, /transport === 'public-square-discovery'/);
  assert.match(vercel, /"source": "\/api\/square\/public"/);
  assert.doesNotMatch(square, /collection\(db|setDoc\(|updateDoc\(|signInWithPopup\(/);
});

test('anonymous Praça projections do not disclose restricted documents or owner details', () => {
  const privateFields = {
    ownerId: 'owner-secret', ownerEmail: 'private@example.test', contact: '11911111111',
    address: 'Rua Privada', buyerId: 'private-buyer', privateNote: 'never-disclose',
  };
  const store = projectPublicSquareStore({
    ...privateFields, listingType: 'store', publicationStatus: 'published',
    storeId: 'store-123', name: 'Loja', slug: 'loja', description: 'Produtos',
    logo: 'https://example.test/logo.png', keywords: ['roupas'],
  });
  assert.ok(store);
  const storeContent = JSON.stringify(store);
  for (const hidden of ['owner-secret', 'private@example.test', '11911111111', 'Rua Privada', 'private-buyer', 'never-disclose']) {
    assert.equal(storeContent.includes(hidden), false);
  }
  assert.equal(projectPublicSquareStore({ publicationStatus: 'draft', name: 'Rascunho', storeId: 's', slug: 'draft' }), null);
  assert.equal(projectPublicSquareCommunity({ communityId: 'private', name: 'Privada', visibility: 'private' }), null);
  assert.equal(projectPublicSquareSocialPost('post-x', { authorName: 'Pessoa', visibility: 'private', createdAtIso: new Date().toISOString() }), null);
  const community = { visibility: 'public', name: 'Comunidade aberta' };
  const post = { communityId: 'community-1', authorName: 'Autor', content: 'Público' };
  const pointer = { communityId: 'community-1', postId: 'post-1', createdAtIso: new Date().toISOString() };
  assert.ok(projectPublicSquareCommunityPost('post-1', pointer, community, post));
  assert.equal(projectPublicSquareCommunityPost('post-1', pointer, { ...community, visibility: 'private' }, post), null);
  assert.equal(projectPublicSquareCommunityPost('post-1', pointer, community, { ...post, communityId: 'other' }), null);
});

test('signed-in community directory reconciles the same public IDs without weakening private reads', () => {
  const directory = readFileSync('src/hooks/useCommunityDirectory.ts', 'utf8');
  const cloud = readFileSync('src/utils/communityCloud.ts', 'utf8');
  assert.match(directory, /fetch\('\/api\/square\/public'/);
  assert.match(directory, /getPublicCommunityFromServer/);
  assert.match(directory, /publicReconciled/);
  assert.match(directory, /subscribeDiscoverableCommunities/);
  assert.match(directory, /privateMembershipCommunities/);
  assert.match(cloud, /getLiteDoc\(liteDoc\(liteDb, 'communities', communityId\)\)/);
  assert.match(cloud, /const liteDb = getLiteFirestore\(auth\.app\)/);
  assert.match(cloud, /data\.visibility !== 'public' && data\.visibility !== 'moderated'/);
});

test('community discovery cursor is bounded and never accepts forged paths or private data', () => {
  assert.equal(PUBLIC_COMMUNITY_PAGE_SIZE, 20);
  assert.equal(parsePublicCommunityCursor(undefined), null);
  assert.equal(parsePublicCommunityCursor(''), null);
  assert.equal(parsePublicCommunityCursor('fIemZnVFXZsagd6EA6sN'), 'fIemZnVFXZsagd6EA6sN');
  for (const malformed of ['../community', 'x/y', ' ', 'a'.repeat(129), '%2F', 'a?x=1']) {
    assert.throws(() => parsePublicCommunityCursor(malformed), /INVALID_COMMUNITY_CURSOR/);
  }
  assert.equal(projectPublicSquareCommunity({
    communityId: 'private', name: 'Privada', visibility: 'private',
  }), null);
  const service = readFileSync('server/marketplace/publicCommunityPageService.ts', 'utf8');
  assert.match(service, /where\('visibility', 'in', \['public', 'moderated'\]\)/);
  assert.match(service, /orderBy\('__name__'\)/);
  assert.match(service, /startAfter\(cursor\)/);
  assert.match(service, /limit\(PUBLIC_COMMUNITY_PAGE_SIZE \+ 1\)/);
  assert.doesNotMatch(service, /delete\(|update\(|set\(|writeBatch\(|ownerId:/);
  assert.match(api, /transport === 'public-community-page'/);
  assert.match(vercel, /"source": "\/api\/square\/communities"/);
});
