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
    assert.match(communities, /onClose=\{\(\) => setCatalogOpen\(false\)\}/);
    assert.doesNotMatch(communities, /\{catalogOpen && createPortal\(/);
  });

  test('catalog overlay leaves original sticky Kyrub toolbar, brand and session actions visible', () => {
    assert.match(layout, /document\.getElementById\('app-header'\)/);
    assert.match(layout, /document\.getElementById\('kyrub-workspace-brand'\)/);
    assert.match(layout, /getBoundingClientRect\(\)\.bottom/);
    assert.match(layout, /style=\{\{ top: headerBottom \}\}/);
    assert.doesNotMatch(layout, /window\.scrollTo\(0, 0\)/);
    assert.match(app, /id="app-header"/);
    assert.match(app, /sticky top-0/);
    assert.match(app, /id="kyrub-workspace-brand" className="sticky top-16/);
    assert.match(app, /id="kyrub-workspace-signout"/);
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
});
