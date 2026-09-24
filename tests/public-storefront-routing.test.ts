import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const legacyAppSource = readFileSync('src/LegacyApp.tsx', 'utf8');
const publicStorefrontSource = readFileSync(
  'src/components/PublicStorefrontApp.tsx',
  'utf8'
);
const storefrontPanelSource = readFileSync(
  'src/components/LegacyStorefrontPanel.tsx',
  'utf8'
);
const rendaEntrySource = readFileSync(
  'src/components/KyrubRendaEntryApp.tsx',
  'utf8'
);
const returnBridgeSource = readFileSync(
  'src/components/StorefrontReturnBridge.tsx',
  'utf8'
);
const originContextSource = readFileSync(
  'src/utils/storefrontOriginContext.ts',
  'utf8'
);
const marketplaceDiscoveryRouterSource = readFileSync(
  'server/payments/marketplaceDiscoveryRouter.ts',
  'utf8'
);
const marketplaceDiscoveryServiceSource = readFileSync(
  'server/payments/marketplaceDiscoveryService.ts',
  'utf8'
);
const healthSource = readFileSync('api/health.ts', 'utf8');
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

test('application routes public slugs before the Kyrub discovery and authenticated shells', () => {
  assert.match(appSource, /resolveKyrubAppRoute\(window\.location\.pathname\)/);
  assert.match(appSource, /route\.kind === 'public-storefront'/);
  assert.match(appSource, /<PublicStorefrontApp slug=\{route\.slug\}/);
  assert.match(appSource, /fullAppRequested = searchParams\.get\('app'\) === '1'/);
  assert.match(appSource, /<KyrubRendaEntryApp \/>/);
  assert.match(appSource, /route\.legacyRedirect/);
  assert.match(
    appSource,
    /window\.history\.replaceState\(\{\}, '', route\.canonicalPath\)/
  );
});

test('Renda is the canonical direct discovery door before the full app', () => {
  assert.match(appSource, /entry === null \|\| entry === 'renda'/);
  assert.match(appSource, /!fullAppRequested/);
  assert.match(rendaEntrySource, /Comece por aqui/);
  assert.match(rendaEntrySource, /Kyrub Entregas/);
  assert.match(rendaEntrySource, /Kyrub Freelas/);
  assert.match(rendaEntrySource, /Kyrub Ofertas/);
  assert.match(rendaEntrySource, /window\.location\.assign\('\/\?app=1'\)/);
});

test('full Kyrub panel opens on Renda and storefront handoff skips the external Renda entry', () => {
  assert.match(
    legacyAppSource,
    /useState<'perfil' \| 'renda' \| 'kyrub'>\('renda'\)/
  );
  assert.match(
    publicStorefrontSource,
    /window\.location\.assign\('\/\?app=1'\)/
  );
  assert.match(publicStorefrontSource, /href="\/\?app=1"/);
  assert.doesNotMatch(
    publicStorefrontSource,
    /window\.location\.assign\('\/\?entry=renda'\)/
  );
});

test('storefront origin remains an explicit return path while exploring the full Kyrub app', () => {
  assert.match(appSource, /<StorefrontReturnBridge \/>/);
  assert.match(returnBridgeSource, /loadStorefrontOriginContext/);
  assert.match(returnBridgeSource, /Voltar para \{origin\.storeName\}/);
  assert.match(returnBridgeSource, /Retomar loja e pedido de origem/);
  assert.match(returnBridgeSource, /href=\{origin\.path\}/);
  assert.match(rendaEntrySource, /Voltar para \{origin\.storeName\}/);
});

test('storefront origin and cart are session-scoped and expire the navigation context', () => {
  assert.match(originContextSource, /window\.sessionStorage/);
  assert.match(originContextSource, /MAX_CONTEXT_AGE_MS = 12 \* 60 \* 60 \* 1000/);
  assert.match(originContextSource, /saveStorefrontOriginContext/);
  assert.match(originContextSource, /saveStorefrontCart/);
  assert.match(originContextSource, /loadStorefrontCart/);
  assert.doesNotMatch(originContextSource, /localStorage/);
});

test('public storefront loads published projections without requiring login to browse', () => {
  assert.match(
    publicStorefrontSource,
    /\/api\/marketplace-discovery\/public\/\$\{encodeURIComponent\(slug\)\}/
  );
  assert.match(publicStorefrontSource, /<LegacyStorefrontPanel/);
  assert.match(publicStorefrontSource, /<StorefrontPanel/);
  assert.match(publicStorefrontSource, /loadStorefrontCart\(slug\)/);
  assert.match(publicStorefrontSource, /saveStorefrontCart\(slug, cart\)/);
  assert.match(publicStorefrontSource, /id="public-storefront-open-kyrub"/);
  assert.match(publicStorefrontSource, />\s*Acessar meu Kyrub\s*</);
  assert.doesNotMatch(publicStorefrontSource, /if \(!user\) return/);
  assert.doesNotMatch(publicStorefrontSource, /Área da equipe/);
});

test('checkout asks for explicit Google authentication only when identity is required', () => {
  assert.match(publicStorefrontSource, /signInWithPopup\(auth, googleProvider\)/);
  assert.match(publicStorefrontSource, /Seu pedido está preservado/);
  assert.match(publicStorefrontSource, /Entre para continuar/);
  assert.match(publicStorefrontSource, /Continuar com Google/);
  assert.match(publicStorefrontSource, /public-storefront-checkout-google-login/);
  assert.match(publicStorefrontSource, /O login identifica quem está enviando o pedido/);
  assert.match(publicStorefrontSource, /<B2CCartDrawer/);
});

test('anonymous public storefront endpoint returns only a strict published projection', () => {
  assert.match(
    marketplaceDiscoveryRouterSource,
    /router\.get\('\/public\/:slug'/
  );
  assert.match(
    marketplaceDiscoveryRouterSource,
    /loadPublicStorefrontBySlug/
  );
  assert.match(
    marketplaceDiscoveryServiceSource,
    /collection\('marketplace_listings'\)/
  );
  assert.match(
    marketplaceDiscoveryServiceSource,
    /data\.listingType === 'store'/
  );
  assert.match(
    marketplaceDiscoveryServiceSource,
    /data\.publicationStatus === 'published'/
  );
  assert.match(
    marketplaceDiscoveryServiceSource,
    /data\.listingType !== 'offer'/
  );
  assert.match(
    marketplaceDiscoveryServiceSource,
    /data\.publicationStatus !== 'published'/
  );
  assert.doesNotMatch(
    marketplaceDiscoveryServiceSource,
    /ownerEmail:/
  );
  assert.doesNotMatch(
    marketplaceDiscoveryServiceSource,
    /contact:/
  );
});

test('Vercel serves public storefront through the existing health multiplexer', () => {
  const config = JSON.parse(vercelConfig) as {
    rewrites: Array<{ source: string; destination: string }>;
  };
  const routes = new Map(
    config.rewrites.map(rewrite => [rewrite.source, rewrite.destination])
  );

  assert.equal(
    routes.get('/api/marketplace-discovery/public/:slug'),
    '/api/health?transport=public-storefront&slug=:slug'
  );
  assert.match(healthSource, /transport === 'public-storefront'/);
  assert.match(healthSource, /loadPublicStorefrontBySlug\(slug\)/);
  assert.match(healthSource, /request\.query\?\.slug/);
  assert.match(healthSource, /X-Kyrub-Route', 'public-storefront/);
  assert.match(healthSource, /status\(404\)\.json/);
  assert.match(healthSource, /status\(200\)\.json\(result\)/);
  assert.match(healthSource, /PUBLIC_STOREFRONT_TRANSPORT_UNAVAILABLE/);
  assert.equal(
    existsSync('api/marketplace-discovery/public/[slug].ts'),
    false,
    'public storefront must reuse the existing serverless multiplexer instead of consuming another Hobby function slot'
  );
});

test('authenticated storefront enrichments stay behind an authenticated user', () => {
  assert.match(publicStorefrontSource, /user && <BuyerDeliveryTrackingBridge/);
  assert.match(publicStorefrontSource, /if \(!user \|\| !store\?\.id\) return/);
  assert.match(publicStorefrontSource, /subscribeToStoreCustomerOrders/);
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

test('the staff route opens the real retailer workspace after Google authentication', () => {
  assert.match(appSource, /operational=\{route\.kind === 'staff-app'\}/);
  assert.match(appSource, /<OperationalAppEntryBridge/);
  assert.match(operationalEntrySource, /onAuthStateChanged/);
  assert.match(operationalEntrySource, /btn-criar-loja-ofertas/);
  assert.match(operationalEntrySource, /rendaButton\.click\(\)/);
  assert.match(operationalEntrySource, /retailerButton\.click\(\)/);
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
