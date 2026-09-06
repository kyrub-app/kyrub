import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Gerencial bypasses the modern RetailerPanel polling wrapper', () => {
  const routerSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');
  const legacyWrapperSource = readFileSync(
    'src/components/RetailerPanelLegacyWrapper.tsx',
    'utf8'
  );

  assert.match(routerSource, /props\.activeSubTab === 'gerencial'/);
  assert.match(routerSource, /<LegacyRetailerPanel \{\.\.\.props\} \/>/);
  assert.match(routerSource, /<ModernRetailerPanel \{\.\.\.props\} \/>/);
  assert.match(legacyWrapperSource, /synchronizeProductsWorkspace/);
  assert.match(legacyWrapperSource, /setTimeout\(synchronizeProductsWorkspace, 80\)/);
  assert.doesNotMatch(routerSource, /synchronizeProductsWorkspace/);
});

test('Gerencial has a local recovery boundary', () => {
  const routerSource = readFileSync('src/components/RetailerPanel.tsx', 'utf8');

  assert.match(routerSource, /class GerencialPanelErrorBoundary/);
  assert.match(routerSource, /static getDerivedStateFromError/);
  assert.match(routerSource, /componentDidCatch/);
  assert.match(routerSource, /erp-gerencial-recovery-boundary/);
  assert.match(routerSource, /Voltar ao PDV/);
});
