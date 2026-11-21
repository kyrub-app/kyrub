import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { reconcilePublishedStorefrontCart } from '../src/utils/storefrontOriginContext';
import { buildProductConfigurationSelection } from '../src/utils/productCustomization';
import type { Product } from '../src/types';

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


test('resumed storefront cart drops withdrawn products and refreshes server-priced offers', () => {
  const product = (id: string, price: number, stock = 5) => ({
    id, name: id, description: 'Produto publicado', price, stock,
    category: 'Geral', image: '', supplierId: 'store-owner',
  }) as Product;
  const savedItem = product('active', 19);
  const removedItem = product('withdrawn', 39);
  const saved = [
    { product: savedItem, quantity: 3 },
    { product: removedItem, quantity: 1 },
  ];
  const current = product('active', 25, 4);
  const result = reconcilePublishedStorefrontCart(saved, [current]);

  assert.deepEqual(result, [{ product: current, quantity: 3 }]);
  assert.equal(saved.length, 2, 'the saved cart must not be mutated in place');
  assert.equal(saved[0].product.price, 19);
  assert.match(publicStorefrontSource,
    /setCart\(previous => reconcilePublishedStorefrontCart\(previous, payload\.offers\)\)/);
});


test('resumed storefront cart preserves configured products and reprices current option choices', () => {
  const original = {
    id: 'meal', name: 'Refeição', description: '', price: 20,
    image: '', stock: 8, category: 'Refeições', supplierId: 'owner',
    optionGroups: [{
      id: 'extras', name: 'Extras', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'cheese', name: 'Queijo', priceDelta: 5 }],
    }],
    quickNotes: ['Sem cebola'],
  } as Product;
  const configured = buildProductConfigurationSelection(
    original, { extras: ['cheese'] }, ['Sem cebola'], 'entregar quente'
  );
  const refreshed = {
    ...original, price: 30,
    optionGroups: [{
      id: 'extras', name: 'Extras', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'cheese', name: 'Queijo', priceDelta: 8 }],
    }],
  } as Product;
  const reconciled = reconcilePublishedStorefrontCart([
    { product: configured, quantity: 2 },
  ], [refreshed]);
  assert.equal(reconciled.length, 1);
  assert.equal(reconciled[0].product.id, configured.id);
  assert.equal(reconciled[0].product.price, 38);
  assert.equal(reconciled[0].quantity, 2);
  assert.equal(reconciled[0].product.selectedOptions?.[0]?.priceDelta, 8);
  assert.equal(original.price, 20);
});


test('saved configured item remains in cart when public catalog omits customization metadata', () => {
  const source = {
    id: 'coffee', name: 'Café', description: '', price: 15,
    image: '', stock: 6, category: 'Bebidas', supplierId: 'owner',
    optionGroups: [{
      id: 'milk', name: 'Leite', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'oat', name: 'Aveia', priceDelta: 5 }],
    }],
    quickNotes: ['Sem gelo'],
  } as Product;
  const saved = buildProductConfigurationSelection(
    source, { milk: ['oat'] }, ['Sem gelo']
  );
  const currentPublicOffer = {
    id: 'coffee', name: 'Café', description: '', price: 18,
    image: '', stock: 3, category: 'Bebidas', supplierId: 'owner',
  } as Product;
  const result = reconcilePublishedStorefrontCart(
    [{ product: saved, quantity: 2 }], [currentPublicOffer]
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].product.id, saved.id);
  assert.equal(result[0].product.price, 20, 'do not invent a new option price without metadata');
  assert.equal(result[0].product.stock, 3, 'refresh safe availability data');
  assert.equal(result[0].quantity, 2);
});

test('resumed storefront cart rejects withdrawn configuration choices rather than silently changing them', () => {
  const product = {
    id: 'meal', name: 'Refeição', description: '', price: 20,
    image: '', stock: 5, category: 'Refeições', supplierId: 'owner',
    optionGroups: [{
      id: 'extras', name: 'Extras', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'cheese', name: 'Queijo', priceDelta: 5 }],
    }],
  } as Product;
  const configured = buildProductConfigurationSelection(product, { extras: ['cheese'] });
  const changed = {
    ...product,
    optionGroups: [{
      id: 'extras', name: 'Extras', minSelections: 1, maxSelections: 1,
      choices: [{ id: 'salad', name: 'Salada', priceDelta: 3 }],
    }],
  } as Product;
  assert.deepEqual(reconcilePublishedStorefrontCart([
    { product: configured, quantity: 1 },
  ], [changed]), []);
});

test('resumed storefront cart becomes empty when the store has no published offers', () => {
  const savedProduct = {
    id: 'old', name: 'Antigo', description: '', price: 12, image: '',
    stock: 3, category: 'Geral', supplierId: 'owner',
  } as Product;
  assert.deepEqual(reconcilePublishedStorefrontCart([
    { product: savedProduct, quantity: 2 },
  ], []), []);
});

test('application routes public slugs before the Kyrub discovery and authenticated shells', () => {
  assert.match(appSource, /resolveKyrubAppRoute\(window\.location\.pathname\)/);
  assert.match(appSource, /route\.kind === 'public-storefront'/);
  assert.match(appSource, /<PublicStorefrontApp slug=\{route\.slug\}/);
  assert.match(appSource, /return <KyrubMainEntry \/>/);
  assert.match(appSource, /<KyrubRendaEntryApp \/>/);
  assert.match(appSource, /route\.legacyRedirect/);
  assert.match(
    appSource,
    /window\.history\.replaceState\(\{\}, '', route\.canonicalPath\)/
  );
});

test('Renda workspace is the default discovery door and old introduction remains available', () => {
  assert.match(appSource, /return <KyrubMainEntry \/>/);
  assert.match(appSource, /entry === 'welcome' \|\| entry === 'renda'/);
  assert.match(appSource, /<KyrubGuestWorkspace \/>/);
  assert.match(appSource, /<AuthenticatedKyrubApp operational=\{false\} \/>/);
  assert.match(rendaEntrySource, /Comece por aqui/);
  assert.match(rendaEntrySource, /Kyrub Entregas/);
  assert.match(rendaEntrySource, /Kyrub Freelas/);
  assert.match(rendaEntrySource, /Kyrub Ofertas/);
  assert.match(rendaEntrySource, /window\.location\.assign\('\/\?app=1'\)/);
});

test('full Kyrub panel opens on Renda and storefront handoff skips the external Renda entry', () => {
  assert.match(
    legacyAppSource,
    /useState<ActiveMainTab>\([\s\S]*?retainedWorkspaceTabByUser\.get\(auth\.currentUser\?\.uid \?\? ''\)\?\.activeTab \?\? 'renda'/
  );
  assert.match(legacyAppSource, /type ActiveMainTab = 'perfil' \| 'habilidades' \| 'renda' \| 'kyrub' \| 'cairubia'/);
  assert.match(legacyAppSource, /retainedWorkspaceTabByUser\.set\(uid/);
  assert.match(legacyAppSource, /retainedWorkspaceTabByUser\.delete\(signingOutUid\)/);
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
  assert.match(appSource, /<AuthenticatedKyrubApp operational \/>/);
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

test('navigation headers stay sticky while brand session buttons scroll on both account states', () => {
  const profileSource = readFileSync('src/components/modals/UserProfileModal.tsx', 'utf8');
  const guestSource = readFileSync('src/components/KyrubGuestWorkspace.tsx', 'utf8');
  const appHeader = legacyAppSource.match(/<header className="border-b[\s\S]*?id="app-header">([\s\S]*?)<\/header>/)?.[1] ?? '';
  const guestHeader = guestSource.match(/<header id="app-header"([\s\S]*?)<\/header>/)?.[1] ?? '';

  assert.ok(appHeader.length > 0, 'authenticated app header should exist');
  assert.ok(guestHeader.length > 0, 'guest app header should exist');
  assert.ok(appHeader.indexOf('id="header-user-profile-trigger"') < appHeader.indexOf('id="header-kyrubia-trigger"'));
  assert.equal((appHeader.match(/id="header-user-profile-trigger"/g) ?? []).length, 1);
  assert.doesNotMatch(appHeader, /<LogOut|aria-label="Sair"|title="Sair"/);
  assert.match(appHeader, /mr-auto w-10 h-10 rounded-xl/);

  assert.ok(guestHeader.indexOf('id="header-user-profile-trigger"') < guestHeader.indexOf('id="header-kyrubia-trigger"'));
  assert.equal((guestHeader.match(/id="header-user-profile-trigger"/g) ?? []).length, 1);
  assert.doesNotMatch(guestHeader, /<LogIn|<LogOut/);
  assert.match(guestHeader, /requestLogin\('acessar seu perfil'\)/);

  assert.match(legacyAppSource, /id="app-header"/);
  assert.match(legacyAppSource, /sticky top-0 z-40/);
  assert.match(guestSource, /id="app-header" className="sticky top-0 z-40/);
  assert.match(legacyAppSource, /id="kyrub-workspace-brand" className="flex min-h-10/);
  assert.doesNotMatch(legacyAppSource, /id="kyrub-workspace-brand" className="sticky/);
  assert.match(legacyAppSource, /id="kyrub-workspace-signout"/);
  assert.match(legacyAppSource, /onClick=\{\(\) => void handleLogout\(\)\}/);
  assert.match(legacyAppSource, /disabled=\{isSigningOut\}/);
  assert.match(guestSource, /id="kyrub-guest-brand" className="flex min-h-10/);
  assert.doesNotMatch(guestSource, /id="kyrub-guest-brand" className="sticky/);
  assert.doesNotMatch(profileSource, /personal-profile-auth-trigger|onAuthAction|isAuthBusy/);
  assert.match(profileSource, /id="personal-profile-settings-trigger"/);
  assert.match(guestSource, /id="kyrub-guest-brand"/);
  assert.match(guestSource, /id="kyrub-guest-signin"/);
  assert.match(guestSource, /requestLogin\('acessar sua conta'\)/);
  assert.doesNotMatch(profileSource, /profile-logout-button|profile-session-actions|onLogout/);
  assert.match(legacyAppSource, /await signOut\(auth\)/);
  assert.match(legacyAppSource, /retainedWorkspaceTabByUser\.delete\(signingOutUid\)/);
  assert.match(legacyAppSource, /triggerToast\('Não foi possível sair da conta\. Tente novamente\.'/);
});


test('cultural guides and assistant header match the approved information architecture', () => {
  const guestSource = readFileSync('src/components/KyrubGuestWorkspace.tsx', 'utf8');
  const learningSource = readFileSync('src/components/tabs/JemboeHabilidadesTab.tsx', 'utf8');
  const workspaceBridge = readFileSync('src/components/KyrubAiWorkspaceBridge.tsx', 'utf8');
  const enrolledProviderActions = /startEnrollment|createEnrollment|grantPaidAccess|authMagicLink/;

  // Profile remains first; Cairúbia uses its old second header slot.
  assert.ok(legacyAppSource.indexOf('id="header-user-profile-trigger"') <
    legacyAppSource.indexOf('id="header-kyrubia-trigger"'));
  assert.ok(legacyAppSource.indexOf('id="header-kyrubia-trigger"') <
    legacyAppSource.indexOf('id="header-tasks-trigger"'));
  assert.ok(guestSource.indexOf('id="header-user-profile-trigger"') <
    guestSource.indexOf('id="header-kyrubia-trigger"'));
  assert.ok(guestSource.indexOf('id="header-kyrubia-trigger"') <
    guestSource.indexOf('id="header-tasks-trigger"'));

  assert.match(legacyAppSource, /onClick=\{\(\) => setActiveTab\('cairubia'\)\}/);
  assert.match(guestSource, /onClick=\{\(\) => setTab\('cairubia'\)\}/);
  assert.match(legacyAppSource, /activeTab === 'cairubia' && \(\s*<div id="kyrub-tab-container"/);
  assert.match(workspaceBridge, /getElementById\('kyrub-tab-container'\)/);

  // Same three guide names and translations in signed-in and guest views.
  for (const label of ['Jemboé', 'Catu', 'Taba']) {
    assert.match(legacyAppSource, new RegExp('<span>' + label + '<\\/span>'));
    assert.ok(guestSource.includes("'" + label + "'"));
  }
  assert.match(legacyAppSource, /activeTab === 'habilidades' && <JemboeHabilidadesTab/);
  assert.match(guestSource, /tab === 'habilidades' && <JemboeHabilidadesTab/);
  assert.doesNotMatch(legacyAppSource.match(/<nav className="fixed bottom-[\s\S]*?<\/nav>/)?.[0] ?? '', /<span>Cairúbia<\/span>/);
  assert.doesNotMatch(guestSource.match(/<nav className="fixed bottom-[\s\S]*?<\/nav>/)?.[0] ?? '', /'cairubia', Sparkles/);

  assert.match(learningSource, /id="jemboe-kyrub-cursos-link"/);
  assert.match(learningSource, /https:\/\/smartlyst\.com\.br\/platform\/kyrubcursos/);
  assert.match(learningSource, /target="_blank" rel="noopener noreferrer"/);
  // Jemboé deliberately opens directly on the external classroom access.
  // The marked hero and three explainer cards must not return unnoticed.
  assert.doesNotMatch(learningSource, /KYRUBIA_LEARNING_TRACKS|Trilhas de aprendizagem/);
  assert.doesNotMatch(learningSource, /Aprenda uma habilidade\. Transforme conhecimento/);
  assert.doesNotMatch(learningSource, /Aprender para gerar renda|Aprender a empreender|Aprender a usar o Kyrub/);
  assert.match(learningSource, /Acesse a sala de aula/);
  assert.doesNotMatch(learningSource, enrolledProviderActions);
});


test('Marketplace remains reachable through Taba and Lojas, without a duplicate header shortcut', () => {
  const guestSource = readFileSync('src/components/KyrubGuestWorkspace.tsx', 'utf8');
  const socialSource = readFileSync('src/components/tabs/KyrubTab.tsx', 'utf8');
  const storesSource = readFileSync('src/components/tabs/SquareStoresSection.tsx', 'utf8');
  const authenticatedHeader = legacyAppSource.match(/<header className="border-b[\s\S]*?id="app-header">([\s\S]*?)<\/header>/)?.[1] ?? '';
  const guestHeader = guestSource.match(/<header id="app-header"([\s\S]*?)<\/header>/)?.[1] ?? '';

  assert.ok(authenticatedHeader && guestHeader);
  assert.doesNotMatch(authenticatedHeader, /header-marketplace-trigger|aria-label="Abrir Marketplace"/);
  assert.doesNotMatch(guestHeader, /header-marketplace-trigger|aria-label="Abrir Marketplace"/);

  // Taba is the main destination regardless of auth state; no marketplace link is lost.
  assert.match(legacyAppSource, /aria-label="Taba — Praça"/);
  assert.match(legacyAppSource, /setSocialSubTab\('usuarios'\);\s*setPracaFilter\('recentes'\);\s*setActiveTab\('kyrub'\)/);
  assert.match(guestSource, /\['praca', Compass, 'Taba', 'Praça'\]/);
  const guestSquareSource = readFileSync('src/components/GuestSquarePanel.tsx', 'utf8');
  assert.match(guestSource, /<GuestSquarePanel onLoginRequired=\{requestLogin\}/);
  assert.match(guestSquareSource, /<SquareStoresSection/);
  // Official storefront access is now shared by the guest and signed-in store catalog.
  assert.match(storesSource, /href=\{OFFICIAL_STORE_PATH\}/);
  assert.match(socialSource, /<SquareStoresSection/);
  assert.match(socialSource, /onViewAll=\{\(\) => setStoreCatalogOpen\(true\)\}/);
  assert.match(storesSource, /id="square-stores-view-all"/);
  assert.match(storesSource, /href=\{OFFICIAL_STORE_PATH\}/);
});
