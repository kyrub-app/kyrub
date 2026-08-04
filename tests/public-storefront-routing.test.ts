import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const publicStorefrontSource = readFileSync(
  'src/components/PublicStorefrontApp.tsx',
  'utf8'
);
const storefrontPanelSource = readFileSync(
  'src/components/LegacyStorefrontPanel.tsx',
  'utf8'
);
const publicStorefrontDataSource = readFileSync(
  'src/utils/publicStorefront.ts',
  'utf8'
);
const operationalEntrySource = readFileSync(
  'src/components/store/OperationalAppEntryBridge.tsx',
  'utf8'
);
const sharingPanelSource = readFileSync(
  'src/components/store/StoreSharingPanel.tsx',
  'utf8'
);
const sharingBridgeSource = readFileSync(
  'src/components/store/StoreSharingPortalBridge.tsx',
  'utf8'
);
const storefrontEventsSource = readFileSync(
  'src/utils/storefrontEvents.ts',
  'utf8'
);
const vercelConfig = readFileSync('vercel.json', 'utf8');

test('application routes public slugs before the authenticated legacy shell', () => {
  assert.match(appSource, /resolveKyrubAppRoute\(window\.location\.pathname\)/);
  assert.match(appSource, /route\.kind === 'public-storefront'/);
  assert.match(appSource, /<PublicStorefrontApp slug=\{route\.slug\}/);
  assert.match(appSource, /route\.legacyRedirect/);
  assert.match(
    appSource,
    /window\.history\.replaceState\(\{\}, '', route\.canonicalPath\)/
  );
});

test('the staff route opens the real retailer workspace after Google authentication', () => {
  assert.match(appSource, /operational=\{route\.kind === 'staff-app'\}/);
  assert.match(appSource, /<OperationalAppEntryBridge/);
  assert.match(operationalEntrySource, /onAuthStateChanged/);
  assert.match(operationalEntrySource, /btn-criar-loja-ofertas/);
  assert.match(operationalEntrySource, /rendaButton\.click\(\)/);
  assert.match(operationalEntrySource, /retailerButton\.click\(\)/);
});

test('direct storefront keeps checkout authenticated without advertising staff access', () => {
  assert.match(publicStorefrontSource, /onAuthStateChanged/);
  assert.match(publicStorefrontSource, /signInWithPopup/);
  assert.match(publicStorefrontSource, /subscribeToPublishedStorefrontBySlug/);
  assert.match(publicStorefrontSource, /<StorefrontPanel/);
  assert.match(publicStorefrontSource, /<B2CCartDrawer/);
  assert.match(publicStorefrontSource, /public-storefront-google-login/);
  assert.doesNotMatch(publicStorefrontSource, /Área da equipe/);
  assert.doesNotMatch(publicStorefrontSource, /href="\/app"/);
});

test('public storefront uses the real logo in the header and a banner carousel', () => {
  assert.match(publicStorefrontSource, /Logo de \$\{store\.name\}/);
  assert.match(storefrontPanelSource, /activeConsumerStore\?\.offerImages/);
  assert.match(storefrontPanelSource, /aria-roledescription="carrossel"/);
  assert.match(storefrontPanelSource, /setInterval/);
  assert.match(storefrontPanelSource, /onTouchStart/);
  assert.match(storefrontPanelSource, /onTouchEnd/);
  assert.match(storefrontPanelSource, /bg-gradient-to-t/);
  assert.match(storefrontPanelSource, /line-clamp-3/);
});

test('storefront header owns info and close actions while movement uses fire beside the name', () => {
  assert.match(
    storefrontEventsSource,
    /kyrub:open-public-storefront-info/
  );
  assert.match(
    publicStorefrontSource,
    /id="public-storefront-header-info-trigger"/
  );
  assert.match(publicStorefrontSource, /OPEN_PUBLIC_STOREFRONT_INFO_EVENT/);
  assert.match(publicStorefrontSource, /id="public-storefront-close"/);
  assert.match(publicStorefrontSource, /window\.history\.back\(\)/);
  assert.match(
    storefrontPanelSource,
    /window\.addEventListener\(\s*OPEN_PUBLIC_STOREFRONT_INFO_EVENT/
  );
  assert.match(storefrontPanelSource, /<Flame/);
  assert.doesNotMatch(storefrontPanelSource, /<Zap/);
  assert.doesNotMatch(storefrontPanelSource, /storefront-store-info-trigger/);
  assert.doesNotMatch(storefrontPanelSource, />\s*Vitrine pública\s*</);
});

test('slug lookup reads only published marketplace copies and strips private contact data', () => {
  assert.match(
    publicStorefrontDataSource,
    /where\('publicationStatus', '==', 'published'\)/
  );
  assert.match(publicStorefrontDataSource, /listing\.listingType === 'store'/);
  assert.match(
    publicStorefrontDataSource,
    /normalizeStorefrontSlug\(store\.slug\)/
  );
  assert.match(publicStorefrontDataSource, /ownerEmail: ''/);
  assert.match(publicStorefrontDataSource, /contact: ''/);
});

test('store configuration receives public sharing and staff access controls', () => {
  assert.match(appSource, /<StoreSharingPortalBridge/);
  assert.match(sharingBridgeSource, /store-drive-media-controls/);
  assert.match(sharingBridgeSource, /StoreSharingPanel/);
  assert.match(sharingPanelSource, /id="copy-public-storefront-link"/);
  assert.match(sharingPanelSource, /id="share-public-storefront-link"/);
  assert.match(sharingPanelSource, /id="share-storefront-whatsapp"/);
  assert.match(sharingPanelSource, /id="open-operational-app-link"/);
  assert.match(sharingPanelSource, /\/staff/);
  assert.match(sharingPanelSource, /Abrir \/staff/);
});

test('Vercel sends direct public, staff and legacy app routes to the SPA entry', () => {
  const config = JSON.parse(vercelConfig) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const routes = new Map(
    config.rewrites.map(rewrite => [rewrite.source, rewrite.destination])
  );

  assert.equal(routes.get('/staff'), '/index.html');
  assert.equal(routes.get('/staff/:path*'), '/index.html');
  assert.equal(routes.get('/app'), '/index.html');
  assert.equal(routes.get('/app/:path*'), '/index.html');
  assert.equal(routes.get('/@:slug'), '/index.html');
  assert.equal(routes.get('/@:slug/:path*'), '/index.html');
  assert.equal(routes.get('/:slug/staff'), '/index.html');
});
