import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const marketplace = fs.readFileSync(
  'src/components/tabs/KyrubTab.tsx',
  'utf8'
);
const retailer = fs.readFileSync(
  'src/components/LegacyRetailerPanel.tsx',
  'utf8'
);
const legacyMarketplace = fs.readFileSync(
  'src/components/tabs/LegacyKyrubTab.tsx',
  'utf8'
);
const app = fs.readFileSync('src/App.tsx', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');

 test('canonical marketplace reading is opt-in until backend activation', () => {
  const guardIndex = marketplace.indexOf(
    'if (CANONICAL_MARKETPLACE_READ_ENABLED)'
  );
  const canonicalPathIndex = marketplace.indexOf(
    'getMarketplaceListingsCollectionPath()'
  );

  assert.match(marketplace, /VITE_ENABLE_CANONICAL_MARKETPLACE_READ/);
  assert.ok(guardIndex >= 0);
  assert.ok(canonicalPathIndex > guardIndex);
});

test('legacy active tickets remain scoped to local storage', () => {
  assert.match(retailer, /kyrub_legacy_active_tickets_/);
  assert.doesNotMatch(retailer, /active_sessions/);
  assert.doesNotMatch(retailer, /tenant_default/);
  assert.doesNotMatch(retailer, /saveDocLWW/);
  assert.doesNotMatch(retailer, /listenCollection/);
  assert.doesNotMatch(retailer, /runTransaction/);
  assert.doesNotMatch(retailer, /deleteDoc/);
  assert.doesNotMatch(retailer, /from 'firebase\/firestore'/);
});

test('marketplace logo does not render an empty src attribute', () => {
  assert.match(legacyMarketplace, /\{store\.logo \? \(/);
  assert.match(legacyMarketplace, /<StoreIcon className=/);
  assert.doesNotMatch(
    legacyMarketplace,
    /<img[^>]*src=\{store\.logo \|\| ['"]{2}\}/
  );
});

test('pending user store replay waits for the server-confirmed primary store', () => {
  const existsGuard = app.indexOf('!snapshot.exists()');
  const cacheGuard = app.indexOf('snapshot.metadata.fromCache');
  const persistCall = app.indexOf('persistPrivateUserStore(user, cachedStore)');

  assert.match(app, /onSnapshot\(/);
  assert.match(app, /getPrimaryUserStoreDocumentPath\(user\.uid\)/);
  assert.ok(existsGuard >= 0);
  assert.ok(cacheGuard >= 0);
  assert.ok(persistCall > existsGuard);
  assert.ok(persistCall > cacheGuard);
  assert.match(app, /LegacyApp owns the initial create\/read bootstrap/);
});

test('document language and translation guard protect React-managed DOM', () => {
  assert.match(indexHtml, /<html lang="pt-BR" translate="no">/);
  assert.match(indexHtml, /<meta name="google" content="notranslate" \/>/);
  assert.match(indexHtml, /<body class="notranslate">/);
  assert.match(indexHtml, /<div id="root" class="notranslate"><\/div>/);
  assert.match(indexHtml, /<link rel="icon" href="\/favicon\.ico" sizes="any" \/>/);
  assert.equal(fs.existsSync('public/favicon.ico'), true);
});
