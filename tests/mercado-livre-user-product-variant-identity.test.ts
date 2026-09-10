import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const requirementsPath = new URL('../server/integrations/mercadoLivreOutboundRequirementsService.ts', import.meta.url);
const payloadAdapterPath = new URL('../server/integrations/mercadoLivreInitialPublicationPayloadAdapter.ts', import.meta.url);
const variantIdentityPath = new URL('../server/integrations/mercadoLivreCanonicalVariantIdentityService.ts', import.meta.url);
const e2eRouterPath = new URL('../server/integrations/mercadoLivreE2ETestRouter.ts', import.meta.url);
const e2eClientPath = new URL('../src/utils/mercadoLivreE2ETest.ts', import.meta.url);
const wizardPath = new URL('../src/components/store/MercadoLivreRequirementsWizard.tsx', import.meta.url);
const workspacePath = new URL('../src/components/store/MercadoLivreE2ETestWorkspace.tsx', import.meta.url);

test('User Product family name is explicit while legacy clients retain a named compatibility fallback', async () => {
  const source = await readFile(requirementsPath, 'utf8');
  assert.match(source, /familyName\?: unknown/);
  assert.match(source, /const suppliedFamilyName = clean\(input\.familyName, 120\)/);
  assert.match(source, /suppliedFamilyName \|\| proposal\.canonical\.name/);
  assert.match(source, /canonical_name_compatibility_fallback/);
  assert.match(source, /familyNameAuthority/);
  assert.match(source, /providerFamilyNameAuthority: familyNameAuthority/);
});

test('User Product publication payload uses family_name and never falls back to legacy variations array', async () => {
  const source = await readFile(payloadAdapterPath, 'utf8');
  assert.match(source, /publicationModel === 'user_products'/);
  assert.match(source, /const familyName = clean\(input\.familyName, 120\)/);
  assert.match(source, /family_name: familyName/);
  assert.match(source, /title: name/);
  assert.doesNotMatch(source, /variations\s*:/);
});

test('canonical variant identity is derived only from owner-confirmed, provider-validated User Product dimensions', async () => {
  const source = await readFile(variantIdentityPath, 'utf8');
  assert.match(source, /record\.providerPublicationModel !== 'user_products'/);
  assert.match(source, /record\.status !== 'ready_for_owner_authorization'/);
  assert.match(source, /record\.authority !== 'provider_items_validate'/);
  assert.match(source, /\/categories\/\$\{encodeURIComponent\(proposal\.providerCategoryId\)\}\/attributes/);
  assert.match(source, /tags\.variation_attribute === true/);
  assert.match(source, /tags\.allow_variations === true/);
  assert.match(source, /canonicalBaselineHashFrom/);
  assert.match(source, /currentBaselineHash !== proposal\.canonicalBaselineHash/);
  assert.match(source, /'catalogProfile\.variantIdentity'/);
  assert.match(source, /catalogVariantIdentityConfirmations/);
  assert.match(source, /store_owner_confirmed_user_product_variant/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|mercadoLivreValidateJson/);
});

test('variant identity confirmation is an owner-authenticated E2E action and not a publication write', async () => {
  const router = await readFile(e2eRouterPath, 'utf8');
  const client = await readFile(e2eClientPath, 'utf8');
  assert.match(router, /confirm-variant-identity/);
  assert.match(router, /authenticatedOwner/);
  assert.match(router, /confirmMercadoLivreCanonicalVariantIdentity/);
  assert.match(router, /confirmedByUserId: identity\.uid/);
  assert.match(client, /confirmMercadoLivreE2EVariantIdentity/);
  assert.match(client, /confirm-variant-identity/);
  assert.doesNotMatch(router, /mercadoLivrePostJson|mercadoLivreValidateJson/);
});

test('wizard and E2E workspace expose family and optional variant confirmation without bypassing one-time publication authorization', async () => {
  const wizard = await readFile(wizardPath, 'utf8');
  const workspace = await readFile(workspacePath, 'utf8');
  assert.match(wizard, /Nome da família/);
  assert.match(wizard, /familyNameReady/);
  assert.match(wizard, /onFamilyNameChange/);
  assert.match(wizard, /publicationModel === 'user_products'/);
  assert.match(workspace, /familyName: familyName\.trim\(\) \|\| undefined/);
  assert.match(workspace, /selectedVariationCount/);
  assert.match(workspace, /confirmMercadoLivreE2EVariantIdentity/);
  assert.match(workspace, /Confirmar variante no Kyrub/);
  assert.match(workspace, /authorizeMercadoLivreE2EPublication/);
  assert.match(workspace, /Autorizar publicação real/);
  assert.match(workspace, /Publicar agora/);
});
