import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('browser runtime routes Gerencial around the polling wrapper without moving canonical RetailerPanel', () => {
  const routerSource = readFileSync(
    'src/components/RetailerPanelRuntimeRouter.tsx',
    'utf8'
  );
  const canonicalSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
  const viteSource = readFileSync('vite.config.ts', 'utf8');

  assert.match(routerSource, /props\.activeSubTab === 'gerencial'/);
  assert.match(routerSource, /<LegacyRetailerPanel \{\.\.\.props\} \/>/);
  assert.match(routerSource, /<ModernRetailerPanel \{\.\.\.props\} \/>/);
  assert.match(canonicalSource, /subscribeToStoreCustomerOrders/);
  assert.match(canonicalSource, /setTimeout\(synchronizeProductsWorkspace, 80\)/);
  assert.doesNotMatch(routerSource, /synchronizeProductsWorkspace/);
  assert.match(viteSource, /find: \/\^\\\.\\\/components\\\/RetailerPanel\$\//);
  assert.match(viteSource, /RetailerPanelRuntimeRouter\.tsx/);
});

test('Gerencial runtime path has a local recovery boundary', () => {
  const routerSource = readFileSync(
    'src/components/RetailerPanelRuntimeRouter.tsx',
    'utf8'
  );

  assert.match(routerSource, /class GerencialPanelErrorBoundary/);
  assert.match(routerSource, /static getDerivedStateFromError/);
  assert.match(routerSource, /componentDidCatch/);
  assert.match(routerSource, /erp-gerencial-recovery-boundary/);
  assert.match(routerSource, /Voltar ao PDV/);
});

test('mobile runtime commits selection on the next frame instead of depending on dialog close', () => {
  const runtimeSource = readFileSync(
    'src/components/MobileErpMenuRuntime.tsx',
    'utf8'
  );
  const canonicalSource = readFileSync(
    'src/components/MobileErpMenu.tsx',
    'utf8'
  );
  const viteSource = readFileSync('vite.config.ts', 'utf8');

  assert.match(runtimeSource, /if \(dialog\?\.open\) dialog\.close\(\);/);
  assert.match(runtimeSource, /window\.requestAnimationFrame\(\(\) =>/);
  assert.match(runtimeSource, /commitMobileErpMenuSelection\(itemId/);
  assert.match(runtimeSource, /data-kyrub-mobile-menu-runtime="frame-fallback"/);
  assert.match(runtimeSource, /onClose=\{handleDialogClose\}/);
  assert.match(runtimeSource, /const handleDialogClose = \(\): void => \{\s*setIsOpen\(false\);\s*\};/);
  assert.match(viteSource, /MobileErpMenuRuntime\.tsx/);
  assert.doesNotMatch(canonicalSource, /data-kyrub-mobile-menu-runtime="frame-fallback"/);
});