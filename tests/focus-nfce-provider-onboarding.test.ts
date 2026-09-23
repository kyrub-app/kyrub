import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const serviceSource = readFileSync(
  'server/integrations/focusNfceProviderOnboardingService.ts',
  'utf8'
);
const routerSource = readFileSync(
  'server/integrations/focusNfceProviderOnboardingRouter.ts',
  'utf8'
);
const vaultSource = readFileSync(
  'server/integrations/googleSecretManagerVault.ts',
  'utf8'
);
const configSource = readFileSync(
  'server/integrations/fiscalProviderConfigurationRegistry.ts',
  'utf8'
);
const transportSource = readFileSync(
  'server/integrations/storeConnectionsServerlessTransport.ts',
  'utf8'
);

test('Focus onboarding derives all provider authority server-side', () => {
  assert.match(serviceSource, /const ADAPTER_ID = 'focus-nfe'/);
  assert.match(serviceSource, /const ADAPTER_VERSION = '1'/);
  assert.match(serviceSource, /const DOCUMENT_FAMILY = 'nfce'/);
  assert.match(serviceSource, /const ENVIRONMENT = 'sandbox'/);
  assert.match(serviceSource, /canonicalStoreIdForOwner/);
  assert.match(serviceSource, /getFirebaseAdminProjectId\(\)/);
  assert.match(serviceSource, /createHash\('sha256'\)/);
  assert.doesNotMatch(serviceSource, /request\.(body|query|params)/);
  assert.doesNotMatch(routerSource, /body\?\.(adapterId|adapterVersion|documentFamily|environment|canonicalStoreId)/);
});

test('browser readiness never returns secret topology or token', () => {
  const interfaceStart = serviceSource.indexOf('export interface FocusNfceProviderReadiness');
  const interfaceEnd = serviceSource.indexOf('\n}', interfaceStart);
  assert.ok(interfaceStart >= 0 && interfaceEnd > interfaceStart);
  const readModel = serviceSource.slice(interfaceStart, interfaceEnd);
  assert.doesNotMatch(readModel, /credentialSecretRef|secretRef|resourceName|token|value:/i);
  assert.match(readModel, /credentialPresent: boolean/);
  assert.match(readModel, /credentialVersion: string \| null/);
  assert.match(readModel, /verificationStatus:/);
  assert.doesNotMatch(routerSource, /console\.(log|error|warn)/);
});

test('secret is provisioned and versioned before provider configuration becomes active', () => {
  const ensureIndex = serviceSource.indexOf('await vault.ensureSecret(credentialSecretRef)');
  const versionIndex = serviceSource.indexOf('await vault.addVersion(credentialSecretRef, token)');
  const persistIndex = serviceSource.indexOf('.set(stored)');
  assert.ok(ensureIndex >= 0);
  assert.ok(versionIndex > ensureIndex);
  assert.ok(persistIndex > versionIndex);
  assert.match(vaultSource, /response\.status === 409/);
  assert.match(vaultSource, /replication: \{ automatic: \{\} \}/);
  assert.match(vaultSource, /:addVersion/);
});

test('rotation and deactivation preserve protected credential history', () => {
  assert.match(serviceSource, /configureOrRotateFocusNfceProvider/);
  assert.match(serviceSource, /credentialVersion: written\.version/);
  assert.match(serviceSource, /status: 'inactive'/);
  assert.match(serviceSource, /reactivateFocusNfceProvider/);
  assert.match(serviceSource, /vault\.readLatest\(stored\.credentialSecretRef\)/);
  assert.doesNotMatch(serviceSource, /delete\(|destroy\(|disableVersion|destroyVersion/);
  assert.match(configSource, /stored\.status === 'inactive'/);
  assert.match(configSource, /FISCAL_PROVIDER_CONFIGURATION_INACTIVE/);
});

test('onboarding exposes configuration only and never submits a fiscal document', () => {
  assert.match(
    transportSource,
    /\/api\/store-connections\/fiscal-provider\/focus-nfce/
  );
  assert.match(routerSource, /router\.get\('\/:storeId'/);
  assert.match(routerSource, /router\.put\('\/:storeId'/);
  assert.match(routerSource, /router\.post\('\/:storeId\/deactivate'/);
  assert.match(routerSource, /router\.post\('\/:storeId\/reactivate'/);
  assert.doesNotMatch(routerSource, /emit|submit|fiscalAttempt|executeFiscal/i);
  assert.doesNotMatch(serviceSource, /homologacao\.focusnfe|focusnfe\.com\.br|adapter\.submit|fetch\(/i);
  assert.doesNotMatch(serviceSource, /production/i);
});

test('only the Focus sandbox token is accepted from request body', () => {
  const bodyReferences = routerSource.match(/request\.body[^\n]*/g) ?? [];
  assert.ok(bodyReferences.length > 0);
  assert.ok(bodyReferences.every(reference => /token/.test(reference)));
  assert.match(routerSource, /authenticatedOwner/);
  assert.match(routerSource, /identity\.uid !== storeId/);
  assert.doesNotMatch(routerSource, /credentialSecretRef/);
});
