import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sharedCredentialsSource = readFileSync('shared/integrationCredentials.ts', 'utf8');
const platformServiceSource = readFileSync('server/admin/ninetyNineFoodPlatformCredentialService.ts', 'utf8');
const onboardingSource = readFileSync('server/integrations/ninetyNineFoodAdaptiveOnboardingService.ts', 'utf8');
const onboardingRouterSource = readFileSync('server/integrations/ninetyNineFoodAdaptiveOnboardingRouter.ts', 'utf8');
const clientSource = readFileSync('src/utils/ninetyNineFoodIntegration.ts', 'utf8');
const bridgeSource = readFileSync('src/components/store/NinetyNineFoodConnectionBridge.tsx', 'utf8');
const serverSource = readFileSync('server.ts', 'utf8');

test('99Food platform credentials have a dedicated server-side authority', () => {
  assert.match(sharedCredentialsSource, /\| '99food'/);
  assert.match(sharedCredentialsSource, /providerId: '99food'/);
  assert.match(platformServiceSource, /savePlatformCredentials/);
  assert.match(platformServiceSource, /authorizeIntegrationReadiness/);
  assert.match(serverSource, /\/api\/admin\/integrations\/99food/);
  assert.doesNotMatch(platformServiceSource, /response\.json\([\s\S]*clientSecret/);
});

test('merchant onboarding is classified only from provider Discovery authentication metadata', () => {
  assert.match(onboardingSource, /\/\.well-known\/opendelivery/);
  assert.match(onboardingSource, /supportedGrantTypes/);
  assert.match(onboardingSource, /clientIdGeneration/);
  assert.match(onboardingSource, /clientCredentials && byApp/);
  assert.match(onboardingSource, /authorizationCode/);
  assert.match(onboardingSource, /clientCredentials && byMerchant/);
  assert.match(onboardingSource, /platform_managed/);
  assert.match(onboardingSource, /authorization_required/);
  assert.match(onboardingSource, /merchant_credentials_required/);
});

test('normal 99Food merchant UI does not expose provider URLs or universal secret inputs', () => {
  assert.doesNotMatch(bridgeSource, /setBaseUrl|setTokenUrl|URL base da API|URL do token/);
  assert.match(bridgeSource, /plan\.mode === 'merchant_credentials_required'/);
  const credentialSection = bridgeSource.indexOf("plan.mode === 'merchant_credentials_required'");
  const clientIdSection = bridgeSource.indexOf('Client ID da loja');
  const clientSecretSection = bridgeSource.indexOf('Client Secret da loja');
  assert.ok(credentialSection >= 0 && clientIdSection > credentialSection && clientSecretSection > credentialSection);
  assert.match(bridgeSource, /Conectar 99Food/);
});

test('platform-managed merchant connect sends no raw platform credential from browser', () => {
  assert.match(clientSource, /connectNinetyNineFoodAdaptive/);
  assert.match(clientSource, /\/api\/integrations\/99food\/connect-adaptive/);
  assert.match(onboardingRouterSource, /plan\.mode === 'platform_managed'/);
  assert.match(onboardingRouterSource, /resolveNinetyNineFoodPlatformConnectionMaterial/);
  assert.match(onboardingRouterSource, /plan\.mode === 'merchant_credentials_required'/);
  assert.match(onboardingRouterSource, /NINETY_NINE_FOOD_MERCHANT_CREDENTIALS_REQUIRED/);
});

test('authorization-code mode does not invent a provider login endpoint', () => {
  assert.match(onboardingSource, /mode: 'authorization_required'/);
  assert.match(bridgeSource, /não vai inventar uma URL de login/);
  assert.doesNotMatch(onboardingRouterSource, /authorizeUrl|authorizationEndpoint|window\.location/);
});

test('adaptive onboarding is not an availability or fiscal write authority', () => {
  assert.doesNotMatch(onboardingSource, /quantityAvailable|available_quantity|emit.*(?:nfe|nfce|nfse)/i);
  assert.doesNotMatch(onboardingRouterSource, /quantityAvailable|available_quantity|emit.*(?:nfe|nfce|nfse)/i);
});
