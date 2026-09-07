import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { commitMobileErpMenuSelection } from '../src/components/MobileErpMenu';
import {
  buildPublicStorefrontPath,
  buildPublicStorefrontUrl,
  normalizeStorefrontSlug,
  resolveKyrubAppRoute,
} from '../src/utils/appRoutes';
import {
  getPlanCenterUrl,
  isPlanCenterLocation,
} from '../src/utils/planCenter';

describe('Kyrub public and operational routes', () => {
  test('normalizes public store slugs for stable sharing', () => {
    assert.equal(normalizeStorefrontSlug('  Do Máu  '), 'do-mau');
    assert.equal(
      normalizeStorefrontSlug('Pizzaria---Central'),
      'pizzaria-central'
    );
    assert.equal(buildPublicStorefrontPath('Do Máu'), '/@do-mau');
  });

  test('builds public storefront links from the current origin', () => {
    assert.equal(
      buildPublicStorefrontUrl('https://kyrub.com/', 'Do Máu'),
      'https://kyrub.com/@do-mau'
    );
  });

  test('resolves direct public storefront routes', () => {
    assert.deepEqual(resolveKyrubAppRoute('/@do-mau'), {
      kind: 'public-storefront',
      slug: 'do-mau',
      canonicalPath: '/@do-mau',
    });
    assert.equal(resolveKyrubAppRoute('/@do-mau/').kind, 'public-storefront');
  });

  test('resolves the canonical staff app and nested future routes', () => {
    assert.deepEqual(resolveKyrubAppRoute('/staff'), {
      kind: 'staff-app',
      canonicalPath: '/staff',
      legacyRedirect: false,
    });
    assert.equal(
      resolveKyrubAppRoute('/staff/lojas/store-a/pdv').kind,
      'staff-app'
    );
  });

  test('redirects old operational aliases to the staff route', () => {
    assert.deepEqual(resolveKyrubAppRoute('/app'), {
      kind: 'staff-app',
      canonicalPath: '/staff',
      legacyRedirect: true,
    });
    assert.deepEqual(resolveKyrubAppRoute('/app/lojas/store-a/pdv'), {
      kind: 'staff-app',
      canonicalPath: '/staff',
      legacyRedirect: true,
    });
    assert.deepEqual(resolveKyrubAppRoute('/do-mau/staff'), {
      kind: 'staff-app',
      canonicalPath: '/staff',
      legacyRedirect: true,
    });
  });

  test('keeps unrelated application paths in the default shell', () => {
    assert.deepEqual(resolveKyrubAppRoute('/'), {
      kind: 'default',
      canonicalPath: '/',
    });
    assert.equal(resolveKyrubAppRoute('/ajuda').kind, 'default');
  });

  test('keeps the user Plan Center on its own host and safe preview route', () => {
    assert.equal(isPlanCenterLocation('planos.kyrub.com', '/'), true);
    assert.equal(isPlanCenterLocation('planos.localhost', '/'), true);
    assert.equal(isPlanCenterLocation('localhost', '/planos'), true);
    assert.equal(
      isPlanCenterLocation(
        'kyrub-branch.vercel.app',
        '/',
        '?kyrub_plans_preview=1'
      ),
      true
    );
    assert.equal(
      isPlanCenterLocation('www.kyrub.com', '/', '?kyrub_plans_preview=1'),
      false
    );
    assert.equal(isPlanCenterLocation('admin.kyrub.com', '/'), false);
  });

  test('builds Plan Center links without sending Preview users to production', () => {
    assert.equal(
      getPlanCenterUrl({
        hostname: 'www.kyrub.com',
        origin: 'https://www.kyrub.com',
      } as Location),
      'https://planos.kyrub.com'
    );
    assert.equal(
      getPlanCenterUrl({
        hostname: 'kyrub-branch.vercel.app',
        origin: 'https://kyrub-branch.vercel.app',
      } as Location),
      'https://kyrub-branch.vercel.app/?kyrub_plans_preview=1'
    );
  });

  test('mounts Plan Center outside ERP and reuses the existing coupon authority', () => {
    const appSource = readFileSync('src/App.tsx', 'utf8');
    const planCenterSource = readFileSync(
      'src/components/plans/PlanCenterApp.tsx',
      'utf8'
    );
    const profileBridgeSource = readFileSync(
      'src/components/ProfilePlanCenterBridge.tsx',
      'utf8'
    );

    assert.match(appSource, /if \(planCenter\) return <PlanCenterApp \/>/);
    assert.match(appSource, /<ProfilePlanCenterBridge \/>/);
    assert.doesNotMatch(appSource, /<StoreCouponRedemptionBridge \/>/);
    assert.match(planCenterSource, /redeemKyrubCoupon/);
    assert.match(planCenterSource, /KYRUB_COMMERCIAL_PLAN_BILLING_AVAILABLE/);
    assert.match(planCenterSource, /Contratação paga em breve/);
    assert.match(profileBridgeSource, /Plano e faturamento/);
    assert.match(profileBridgeSource, /Abrir Central de Planos/);
  });

  test('mobile ERP navigation uses the browser top layer instead of a custom portal overlay', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );

    assert.match(mobileMenuSource, /useRef<HTMLDialogElement \| null>/);
    assert.match(mobileMenuSource, /<dialog/);
    assert.match(mobileMenuSource, /dialog\.showModal\(\)/);
    assert.match(mobileMenuSource, /dialog\.close\(\)/);
    assert.match(mobileMenuSource, /mobile-erp-navigation-dialog::backdrop/);
    assert.match(mobileMenuSource, /id="mobile-erp-navigation-drawer"/);
    assert.doesNotMatch(mobileMenuSource, /createPortal/);
    assert.doesNotMatch(mobileMenuSource, /document\.body/);
    assert.doesNotMatch(mobileMenuSource, /data-kyrub-mobile-erp-portal/);
    assert.doesNotMatch(mobileMenuSource, /z-\[200\]/);
  });

  test('mobile ERP routes management modules directly without committing legacy Gerencial', () => {
    let selectedTab = '';
    let selectedManagement = '';

    commitMobileErpMenuSelection('integracoes', {
      onOpenStoreConfig: () => undefined,
      onSelectTab: tab => {
        selectedTab = tab;
      },
      onSelectManagementModule: module => {
        selectedManagement = module ?? '';
      },
    });

    assert.equal(selectedTab, '');
    assert.equal(selectedManagement, 'integracoes');

    commitMobileErpMenuSelection('clientes', {
      onOpenStoreConfig: () => undefined,
      onSelectTab: tab => {
        selectedTab = tab;
      },
      onSelectManagementModule: module => {
        selectedManagement = module ?? '';
      },
    });

    assert.equal(selectedTab, 'clientes');
    assert.equal(selectedManagement, '');
  });

  test('mobile ERP waits for the native dialog close event before committing navigation', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );

    assert.match(
      mobileMenuSource,
      /pendingSelectionRef = useRef<MobileErpMenuItemId \| null>\(null\)/
    );
    assert.match(
      mobileMenuSource,
      /pendingSelectionRef\.current = itemId;\s*closeMenu\(\);/
    );
    assert.match(mobileMenuSource, /const handleDialogClose = \(\): void =>/);
    assert.match(mobileMenuSource, /onClose=\{handleDialogClose\}/);
    assert.match(
      mobileMenuSource,
      /const itemId = pendingSelectionRef\.current;\s*pendingSelectionRef\.current = null;\s*if \(!itemId\) return;\s*commitMobileErpMenuSelection/
    );
  });

  test('mobile ERP native dialog stays mounted while the browser owns open and close state', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );

    assert.match(mobileMenuSource, /ref=\{dialogRef\}/);
    assert.match(mobileMenuSource, /onClose=\{handleDialogClose\}/);
    assert.match(mobileMenuSource, /onClick=\{handleDialogClick\}/);
    assert.match(mobileMenuSource, /aria-controls="mobile-erp-navigation-dialog"/);
    assert.doesNotMatch(mobileMenuSource, /hidden=\{!isOpen\}/);
    assert.doesNotMatch(mobileMenuSource, /isOpen && isRetailer/);
  });

  test('mobile ERP navigation uses only native dialog and local button handlers', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );

    assert.doesNotMatch(mobileMenuSource, /window\.addEventListener/);
    assert.doesNotMatch(mobileMenuSource, /event\.stopPropagation\(\)/);
    assert.doesNotMatch(mobileMenuSource, /onTouchStart=/);
    assert.doesNotMatch(mobileMenuSource, /onTouchEnd=/);
    assert.doesNotMatch(mobileMenuSource, /event\.preventDefault\(\)/);
    assert.doesNotMatch(mobileMenuSource, /\.inert\s*=/);
    assert.doesNotMatch(mobileMenuSource, /document\.documentElement\.style\.overflow/);
    assert.match(mobileMenuSource, /onClick=\{closeMenu\}/);
    assert.match(
      mobileMenuSource,
      /onClick=\{\(\) => handleSelect\(item\.id\)\}/
    );
  });

  test('mobile ERP removes Gerencial and keeps flattened management modules scroll-safe', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );

    const storePosition = mobileMenuSource.indexOf("id: 'loja'");
    const productsPosition = mobileMenuSource.indexOf("id: 'produtos'");
    const integrationsPosition = mobileMenuSource.indexOf("id: 'integracoes'");
    const pdvPosition = mobileMenuSource.indexOf("id: 'clientes'");

    assert.ok(storePosition >= 0);
    assert.ok(productsPosition > storePosition);
    assert.ok(integrationsPosition > productsPosition);
    assert.ok(pdvPosition > integrationsPosition);
    assert.equal(mobileMenuSource.includes("id: 'gerencial', label: 'Gerencial'"), false);
    assert.match(mobileMenuSource, /safe-area-inset-bottom/);
    assert.match(mobileMenuSource, /scrollPaddingBottom: '5rem'/);
    assert.match(mobileMenuSource, /data-kyrub-mobile-menu-item=\{item\.id\}/);
    assert.match(mobileMenuSource, />\s*Gestão\s*</);
    assert.match(mobileMenuSource, />\s*Operação\s*</);
  });

  test('mobile ERP native dialog keeps all drawer controls explicit and tappable', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );

    assert.match(mobileMenuSource, /aria-label="Fechar menu"/);
    assert.match(mobileMenuSource, /aria-label="Abrir menu do painel de gestão"/);
    assert.match(mobileMenuSource, /touch-manipulation/);
    assert.match(
      mobileMenuSource,
      /if \(event\.target === event\.currentTarget\) closeMenu\(\)/
    );
  });

  test('global modal layout skips self-managed drawers, popovers and viewport panels', () => {
    const modalLayoutSource = readFileSync(
      'src/components/AppModalLayoutBridge.tsx',
      'utf8'
    );
    const cartDrawerSource = readFileSync(
      'src/components/modals/B2CCartDrawer.tsx',
      'utf8'
    );
    const notificationCenterSource = readFileSync(
      'src/components/UserNotificationCenterBridge.tsx',
      'utf8'
    );
    const storeChatSource = readFileSync(
      'src/components/store/StoreCustomerChatModal.tsx',
      'utf8'
    );

    assert.ok(modalLayoutSource.includes('usesSelfManagedOverlayLayout'));
    assert.ok(
      modalLayoutSource.includes("hasClassToken(overlay, 'justify-end')")
    );
    assert.ok(modalLayoutSource.includes("hasClassToken(panel, 'h-full')"));
    assert.ok(modalLayoutSource.includes("hasClassToken(panel, 'absolute')"));
    assert.ok(modalLayoutSource.includes("hasClassToken(panel, 'h-[100dvh]')"));
    assert.ok(
      modalLayoutSource.includes(
        'if (!panel || usesSelfManagedOverlayLayout(overlay, panel)) return;'
      )
    );

    assert.ok(cartDrawerSource.includes('fixed inset-0 z-50 flex justify-end'));
    assert.ok(cartDrawerSource.includes('flex h-full w-full max-w-md'));
    assert.ok(
      notificationCenterSource.includes('id="canonical-notification-center"')
    );
    assert.ok(
      notificationCenterSource.includes('className="absolute inset-x-2 top-')
    );
    assert.ok(storeChatSource.includes('id="store-customer-chat-modal"'));
    assert.ok(storeChatSource.includes('h-[100dvh]'));
  });
});
