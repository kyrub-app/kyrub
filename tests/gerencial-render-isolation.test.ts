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
