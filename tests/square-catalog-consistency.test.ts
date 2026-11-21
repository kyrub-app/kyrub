import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const layout = readFileSync('src/components/SquareDirectoryLayout.tsx', 'utf8');
const stores = readFileSync('src/components/tabs/SquareStoresSection.tsx', 'utf8');
const square = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
const communities = readFileSync('src/components/ProfileCommunitiesCloudBridge.tsx', 'utf8');
const app = readFileSync('src/LegacyApp.tsx', 'utf8');

describe('Praça catalog parity', () => {
  test('both directories render one shared catalog shell with equivalent controls', () => {
    assert.match(stores, /<SquareDirectoryLayout\s/);
    assert.match(communities, /<SquareDirectoryLayout\s/);
    assert.match(stores, /title="Todas as lojas"/);
    assert.match(communities, /title="Todas as comunidades"/);
    assert.match(layout, /DIRECTORY_TABS/);
    assert.match(layout, /Participante/);
    assert.match(layout, /Favoritos/);
    assert.match(layout, /Em alta/);
    assert.match(layout, /Todas as categorias/);
    assert.match(layout, /overflow-y-auto overscroll-contain/);
    assert.match(stores, /catalogCategories/);
    assert.match(communities, /catalogCategories/);
    assert.match(stores, /grid grid-cols-2 items-stretch/);
    assert.match(communities, /grid grid-cols-2 items-stretch/);
  });

  test('Ver todas opens a dedicated store directory and returns to the Praça', () => {
    assert.match(square, /onViewAll=\{\(\) => setStoreCatalogOpen\(true\)\}/);
    assert.match(square, /catalogOpen\s+onCloseCatalog=\{\(\) => setStoreCatalogOpen\(false\)\}/);
    assert.match(stores, /onClose=\{\(\) => onCloseCatalog\?\.\(\)\}/);
    assert.match(square, /setStoreCatalogOpen\(false\);\s*props\.setVisitingStore\(store\);/);
    assert.match(communities, /onClose=\{\(\) => setCatalogOpen\(false\)\}/);
    assert.doesNotMatch(communities, /\{catalogOpen && createPortal\(/);
  });

  test('catalog overlay preserves sticky Kyrub toolbar and brand, with session control in Central', () => {
    assert.match(layout, /document\.getElementById\('app-header'\)/);
    assert.match(layout, /document\.getElementById\('kyrub-workspace-brand'\)/);
    assert.match(layout, /getBoundingClientRect\(\)\.bottom/);
    assert.match(layout, /style=\{\{ top: headerBottom \}\}/);
    assert.doesNotMatch(layout, /window\.scrollTo\(0, 0\)/);
    assert.match(app, /id="app-header"/);
    assert.match(app, /sticky top-0/);
    assert.match(app, /id="kyrub-workspace-brand" className="sticky top-16/);
    assert.doesNotMatch(app, /id="kyrub-workspace-signout"/);
    assert.match(app, /onAuthAction=\{\(\) => \{/);
    const personalCenter = readFileSync('src/components/modals/UserProfileModal.tsx', 'utf8');
    assert.match(personalCenter, /id="personal-profile-auth-trigger"/);
  });

  test('store directory reuses official discovery, real participation and favorite state', () => {
    assert.match(stores, /marketplace-discovery\/public\/kyrub-oficial/);
    assert.match(stores, /participatingStoreIds/);
    assert.match(stores, /favoriteStoreIds/);
    assert.match(stores, /onToggleFavoriteStore\(store\.id\)/);
    assert.match(stores, /href=\{OFFICIAL_STORE_PATH\}/);
    assert.match(stores, /onOpenStore\(store\.source\)/);
    assert.match(communities, /selectCommunityDirectory\(communities, catalogTab/);
    assert.match(communities, /renderCard\(community, 'catalog'\)/);
  });

  test('Praça rail and full catalog have the same icon-free Avaliações | Entrar actions', () => {
    const catalog = stores.slice(
      stores.indexOf('if (catalogOpen)'),
      stores.indexOf('return (\n    <section id="square-stores"'),
    );
    const rail = stores.slice(stores.indexOf('return (\n    <section id="square-stores"'));

    for (const surface of [catalog, rail]) {
      assert.match(surface, /grid grid-cols-2 gap-1\.5 border-t border-slate-800/);
      assert.match(surface, /onClick=\{\(\) => onOpenReviews\(storeForReviews\(store\)\)\}/);
      assert.match(surface, /Abrir avaliações da loja/);
      assert.match(surface, /<a href=\{OFFICIAL_STORE_PATH\}[\s\S]*?>\s*Entrar\s*<\/a>/);
      assert.match(surface, /onClick=\{\(\) => store\.source && onOpenStore\(store\.source\)\}/);
      assert.match(surface, />\s*Entrar\s*<\/button>/);
      assert.doesNotMatch(surface, /<MessageCircle|<ShoppingBag|Abrir loja/);
      assert.match(surface, /text-xs font-bold/);
    }

    // Rail cards are now wide enough for two legible text labels.
    assert.match(rail, /w-\[206px\] shrink-0/);
    assert.match(rail, /text-base font-black text-white/);
    assert.match(catalog, /text-sm font-black text-white/);
    assert.match(stores, /store\.source \?\? \{/);
    assert.match(stores, /id: store\.id,\s*name: store\.name/);
    assert.equal((square.match(/onOpenReviews=\{openStoreReviews\}/g) ?? []).length, 2);
    assert.match(square,
      /setStoreCatalogOpen\(false\);\s*props\.setSelectedStoreForMoments\(store\);\s*props\.setShowMomentsModal\(true\);/);
    assert.match(app, /<MomentsModal/);
    assert.match(app, /await publishStoreReview\(selectedStoreForMoments, data\)/);
  });

  test('community rail and both directory headers use the larger text scale', () => {
    assert.match(communities, /w-\[206px\] shrink-0/);
    assert.match(communities, /className="mt-1 text-base font-black text-white"/);
    assert.match(communities, /min-h-8 text-sm font-black text-white/);
    assert.match(layout, /className="text-xl font-black text-white"/);
    assert.match(layout, /className="text-sm text-slate-400"/);
    assert.match(layout, /px-3\.5 text-sm font-bold/);
  });
});
