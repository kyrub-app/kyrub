import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('browser runtime routes management modules directly without mounting legacy Gerencial', () => {
  const routerSource = readFileSync(
    'src/components/RetailerPanelRuntimeRouter.tsx',
    'utf8'
  );
  const canonicalSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
  const viteSource = readFileSync('vite.config.ts', 'utf8');

  assert.match(routerSource, /KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT/);
  assert.match(routerSource, /if \(managementModule\)/);
  assert.match(routerSource, /<DirectManagementModule/);
  assert.match(routerSource, /Gerencial foi removido\./);
  assert.doesNotMatch(routerSource, /<LegacyRetailerPanel \{\.\.\.props\} \/>/);
  assert.match(routerSource, /<ModernRetailerPanel \{\.\.\.props\} \/>/);
  assert.match(canonicalSource, /subscribeToStoreCustomerOrders/);
  assert.match(viteSource, /RetailerPanelRuntimeRouter\.tsx/);
});

test('browser mobile ERP runtime removes Gerencial and exposes all management modules directly', () => {
  const runtimeSource = readFileSync(
    'src/components/MobileErpMenuRuntime.tsx',
    'utf8'
  );
  const viteSource = readFileSync('vite.config.ts', 'utf8');

  assert.match(viteSource, /MobileErpMenuRuntime\.tsx/);
  assert.doesNotMatch(runtimeSource, /id: 'gerencial'/);
  assert.doesNotMatch(runtimeSource, /label: 'Gerencial'/);

  for (const moduleId of [
    'produtos',
    'vendas',
    'financeiro',
    'rh',
    'crm',
    'marketing',
    'integracoes',
    'vouchers',
  ]) {
    assert.match(runtimeSource, new RegExp(`id: '${moduleId}'`));
  }

  assert.match(runtimeSource, />\s*Gestão\s*</);
  assert.match(runtimeSource, />\s*Operação\s*</);
});

test('flattened browser menu keeps the Android next-frame selection fallback', () => {
  const runtimeSource = readFileSync(
    'src/components/MobileErpMenuRuntime.tsx',
    'utf8'
  );

  assert.match(runtimeSource, /if \(dialog\?\.open\) dialog\.close\(\);/);
  assert.match(runtimeSource, /window\.requestAnimationFrame\(\(\) =>/);
  assert.match(runtimeSource, /commitMobileErpMenuSelection\(itemId/);
  assert.match(
    runtimeSource,
    /data-kyrub-mobile-menu-runtime="frame-fallback-flat-management"/
  );
  assert.match(runtimeSource, /onClose=\{handleDialogClose\}/);
  assert.match(
    runtimeSource,
    /const handleDialogClose = \(\): void => \{\s*setIsOpen\(false\);\s*\};/
  );
});
