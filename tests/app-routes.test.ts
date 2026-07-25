import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildPublicStorefrontPath,
  buildPublicStorefrontUrl,
  normalizeStorefrontSlug,
  resolveKyrubAppRoute,
} from '../src/utils/appRoutes';

describe('Kyrub public and operational routes', () => {
  test('normalizes public store slugs for stable sharing', () => {
    assert.equal(normalizeStorefrontSlug('  Do Máu  '), 'do-mau');
    assert.equal(normalizeStorefrontSlug('Pizzaria---Central'), 'pizzaria-central');
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

  test('resolves the operational app and nested future routes', () => {
    assert.deepEqual(resolveKyrubAppRoute('/app'), {
      kind: 'staff-app',
      canonicalPath: '/app',
      legacyRedirect: false,
    });
    assert.equal(resolveKyrubAppRoute('/app/lojas/store-a/pdv').kind, 'staff-app');
  });

  test('redirects the legacy staff path to the authenticated operational app', () => {
    assert.deepEqual(resolveKyrubAppRoute('/staff'), {
      kind: 'staff-app',
      canonicalPath: '/app',
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
});
