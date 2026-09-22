import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the application root is protected by a recovery boundary', () => {
  const mainSource = readFileSync('src/main.tsx', 'utf8');
  const boundarySource = readFileSync(
    'src/components/AppErrorBoundary.tsx',
    'utf8'
  );

  assert.match(mainSource, /<AppErrorBoundary>/);
  assert.match(mainSource, /<App\s*\/>/);
  assert.match(mainSource, /if \(!rootElement\)/);
  assert.match(boundarySource, /static getDerivedStateFromError/);
  assert.match(boundarySource, /componentDidCatch/);
  assert.match(boundarySource, /kyrub:client-error/);
  assert.match(boundarySource, /Código do incidente/);
  assert.match(boundarySource, /Recarregar o Kyrub/);
  assert.match(boundarySource, /Voltar ao início/);
});

test('the recovery diagnostic avoids serializing application state', () => {
  const boundarySource = readFileSync(
    'src/components/AppErrorBoundary.tsx',
    'utf8'
  );

  assert.match(boundarySource, /name: error\.name/);
  assert.match(boundarySource, /message: error\.message/);
  assert.match(boundarySource, /componentStack: info\.componentStack/);
  assert.doesNotMatch(boundarySource, /localStorage/);
  assert.doesNotMatch(boundarySource, /sessionStorage/);
  assert.doesNotMatch(boundarySource, /auth\.currentUser/);
});

test('first mobile management selection survives a router that mounts after the event', () => {
  const navigationSource = readFileSync(
    'src/utils/erpManagementNavigation.ts',
    'utf8'
  );
  const routerSource = readFileSync(
    'src/components/RetailerPanelRuntimeRouter.tsx',
    'utf8'
  );

  assert.match(navigationSource, /pendingNavigationRequest/);
  assert.match(navigationSource, /consumePendingErpManagementNavigation/);
  assert.match(
    navigationSource,
    /pendingNavigationRequest = request;[\s\S]*window\.dispatchEvent/
  );
  assert.match(routerSource, /consumePendingErpManagementNavigation/);
  assert.match(
    routerSource,
    /window\.addEventListener\([\s\S]*KYRUB_ERP_MANAGEMENT_NAVIGATION_EVENT[\s\S]*handleManagementNavigation[\s\S]*\);[\s\S]*const pending = consumePendingErpManagementNavigation\(\)/
  );
  assert.match(routerSource, /if \(pending\) setManagementModule\(pending\.module\)/);
  assert.match(routerSource, /previousActiveSubTabRef = useRef\(props\.activeSubTab\)/);
  assert.match(
    routerSource,
    /if \(previousActiveSubTabRef\.current === props\.activeSubTab\) return;/
  );
});

test('fiscal homologation is native React content and no longer mutates the hub through a global bridge', () => {
  const mainSource = readFileSync('src/main.tsx', 'utf8');
  const integrationsSource = readFileSync(
    'src/components/GerencialIntegrationsRuntime.tsx',
    'utf8'
  );

  assert.doesNotMatch(mainSource, /FiscalHomologationTabBridge/);
  assert.match(integrationsSource, /'homologation'/);
  assert.match(integrationsSource, /homologation: 'Homologação'/);
  assert.match(integrationsSource, /FiscalHomologationPolicyWorkspace/);
  assert.match(integrationsSource, /FiscalPreflightWorkspace/);
  assert.ok(
    integrationsSource.indexOf('<FiscalHomologationPolicyWorkspace') <
      integrationsSource.indexOf('<FiscalPreflightWorkspace')
  );
  assert.doesNotMatch(integrationsSource, /MutationObserver|createPortal/);
});
