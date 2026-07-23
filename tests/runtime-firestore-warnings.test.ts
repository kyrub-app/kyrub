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
  assert.match(legacyMarketplace, /Logo da loja não informado/);
});
