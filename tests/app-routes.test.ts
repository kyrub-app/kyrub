import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
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

  test('mobile ERP navigation drawer is portaled outside the management overlay', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );
    const modalLayoutSource = readFileSync(
      'src/components/AppModalLayoutBridge.tsx',
      'utf8'
    );

    assert.match(mobileMenuSource, /import \{ createPortal \} from 'react-dom'/);
    assert.match(mobileMenuSource, /createPortal\(/);
    assert.match(mobileMenuSource, /document\.body/);
    assert.match(mobileMenuSource, /data-kyrub-mobile-erp-portal="true"/);
    assert.match(mobileMenuSource, /data-kyrub-skip-top-overlay="true"/);
    assert.match(
      mobileMenuSource,
      /className="pointer-events-auto fixed inset-0 z-\[200\]"/
    );
    assert.match(
      modalLayoutSource,
      /overlay\.dataset\.kyrubSkipTopOverlay === 'true'/
    );
    assert.match(mobileMenuSource, /id="mobile-erp-navigation-drawer"/);
    assert.match(mobileMenuSource, /onSelectTab\(itemId\)/);
  });

  test('mobile ERP navigation keeps every drawer surface interactive', () => {
    const mobileMenuSource = readFileSync(
      'src/components/MobileErpMenu.tsx',
      'utf8'
    );

    assert.match(
      mobileMenuSource,
      /className="pointer-events-auto absolute inset-0 z-0 bg-slate-950\/75 backdrop-blur-sm"/
    );
    assert.match(
      mobileMenuSource,
      /className="pointer-events-auto absolute inset-y-0 right-0 z-10 flex w-\[82vw\]/
    );
    assert.match(
      mobileMenuSource,
      /aria-label="Fechar menu"[\s\S]*?onClick=\{\(\) => setIsOpen\(false\)\}/
    );
    assert.match(mobileMenuSource, /onClick=\{\(\) => handleSelect\(item\.id\)\}/);
    assert.match(mobileMenuSource, /touch-manipulation/);
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
