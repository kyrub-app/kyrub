import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import './fiscal-homologation-policy-ui.test';

const routerSource = readFileSync(
  'server/integrations/storeConnectionOnboardingRouter.ts',
  'utf8'
);

test('homologation policy API exposes only owner-authenticated GET and PUT', () => {
  assert.match(
    routerSource,
    /router\.get\('\/:storeId\/fiscal-policy\/homologation'/
  );
  assert.match(
    routerSource,
    /router\.put\('\/:storeId\/fiscal-policy\/homologation'/
  );

  const start = routerSource.indexOf("router.get('/:storeId/fiscal-policy/homologation'");
  const end = routerSource.indexOf("router.get('/:storeId/inventory-authority-health'", start);
  const policyRoutes = routerSource.slice(start, end);

  assert.match(policyRoutes, /authenticatedOwner/);
  assert.match(policyRoutes, /Cache-Control/);
  assert.match(policyRoutes, /loadFiscalHomologationPolicy/);
  assert.match(policyRoutes, /saveFiscalHomologationPolicy/);
  assert.doesNotMatch(policyRoutes, /router\.(post|patch|delete)\(/i);
});

test('homologation policy PUT whitelists only explicit accounting choices', () => {
  const start = routerSource.indexOf("router.put('/:storeId/fiscal-policy/homologation'");
  const end = routerSource.indexOf("router.get('/:storeId/inventory-authority-health'", start);
  const putRoute = routerSource.slice(start, end);

  assert.match(putRoute, /approveForHomologation: request\.body\?\.approveForHomologation === true/);
  assert.match(putRoute, /policyReference: clean\(request\.body\?\.policyReference\)/);
  assert.match(putRoute, /effectiveFrom: clean\(request\.body\?\.effectiveFrom\)/);
  assert.match(putRoute, /parseFiscalOperationScope\(request\.body\?\.operationScope\)/);
  assert.match(putRoute, /parseFiscalDocumentFamily\(request\.body\?\.documentFamily\)/);
  assert.match(putRoute, /parseFiscalOperationalTrigger\(request\.body\?\.operationalTrigger\)/);
  assert.doesNotMatch(putRoute, /\.\.\.request\.body/);
  assert.doesNotMatch(putRoute, /request\.body\?\.(canonicalStoreId|policyId|version|environment|emissionAuthority|providerCallAllowed|sefazCallAllowed)/);
});

test('homologation policy API rejects unsupported enum values into null instead of inferring replacements', () => {
  assert.match(routerSource, /value === 'goods' \|\| value === 'service' \|\| value === 'mixed'/);
  assert.match(routerSource, /value === 'nfe' \|\| value === 'nfce' \|\| value === 'nfse'/);
  assert.match(routerSource, /value === 'payment_confirmed'/);
  assert.match(routerSource, /value === 'fulfillment_confirmed'/);
  assert.match(routerSource, /value === 'service_completed'/);
});

test('homologation policy API has no fiscal emission route or provider action', () => {
  const routeLines = routerSource
    .split('\n')
    .filter(line => line.includes('fiscal-policy/homologation'))
    .join('\n');

  assert.doesNotMatch(routeLines, /emit|issue|authorize|sefaz/i);
  assert.doesNotMatch(routerSource, /fiscal-policy\/homologation\/emit/i);
});
