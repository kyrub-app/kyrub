import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundConditionalValidationService.ts', import.meta.url);
const listingValidatorPath = new URL('../server/integrations/mercadoLivreOutboundListingValidationService.ts', import.meta.url);
const payloadAdapterPath = new URL('../server/integrations/mercadoLivreInitialPublicationPayloadAdapter.ts', import.meta.url);
const capabilityGuardPath = new URL('../server/integrations/mercadoLivrePublicationCapabilitySnapshotGuard.ts', import.meta.url);
const oauthPath = new URL('../server/integrations/mercadoLivreOauthService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('conditional required attributes are validated with the official provider endpoint', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivrePostJson/);
  assert.match(source, /\/categories\/\$\{encodeURIComponent\(proposal\.providerCategoryId\)\}\/attributes\/conditional/);
  assert.match(source, /required_attributes/);
  assert.match(source, /provider_api_conditional_validation/);
});

test('conditional and listing validation both use the same model-aware initial publication payload adapter', async () => {
  const conditionalSource = await readFile(servicePath, 'utf8');
  const listingSource = await readFile(listingValidatorPath, 'utf8');
  const adapterSource = await readFile(payloadAdapterPath, 'utf8');
  assert.match(conditionalSource, /buildMercadoLivreInitialPublicationPayload/);
  assert.match(listingSource, /buildMercadoLivreInitialPublicationPayload/);
  assert.match(adapterSource, /family_name: name/);
  assert.match(adapterSource, /title: name/);
  assert.match(adapterSource, /publicationModel === 'user_products'/);
  assert.doesNotMatch(servicePath.pathname, /\/items$/);
});

test('attribute requirements are ready only when normal and conditional attributes are satisfied', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /missingRequiredAttributeIds\.length === 0 && missingConditionalAttributeIds\.length === 0/);
  assert.match(source, /conditional_required_attributes/);
  assert.match(source, /executionStatus: 'not_authorized'/);
});

test('conditional validation rechecks seller model, canonical and requirement configuration freshness', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /assertCurrentMercadoLivrePublicationCapability/);
  assert.match(source, /canonicalMatchesProposal/);
  assert.match(source, /currentProposal\.providerCapabilityFingerprint !== proposal\.providerCapabilityFingerprint/);
  assert.match(source, /currentConfiguration\.configuredAt !== configuration\.configuredAt/);
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE/);
  assert.match(source, /adminDb\.runTransaction/);
});

test('listing readiness uses Mercado Livre items validator instead of creating an item', async () => {
  const source = await readFile(listingValidatorPath, 'utf8');
  assert.match(source, /mercadoLivreValidateJson\(storeId, '\/items\/validate', itemPayload\)/);
  assert.match(source, /providerValidation\.status === 204/);
  assert.match(source, /ready_for_owner_authorization/);
  assert.match(source, /needs_correction/);
  assert.match(source, /authority: 'provider_items_validate'/);
  assert.match(source, /executionStatus: 'not_authorized'/);
  assert.doesNotMatch(source, /mercadoLivrePostJson<MercadoLivreCreatedItem>/);
});

test('listing validation rechecks the frozen seller publication model before provider validation', async () => {
  const source = await readFile(listingValidatorPath, 'utf8');
  const guardIndex = source.indexOf('await assertCurrentMercadoLivrePublicationCapability');
  const validateIndex = source.indexOf("mercadoLivreValidateJson(storeId, '/items/validate', itemPayload)");
  assert.ok(guardIndex >= 0);
  assert.ok(validateIndex > guardIndex);
  assert.match(source, /schemaVersion: 2/);
  assert.match(source, /providerCapabilityFingerprint/);
  assert.match(source, /'legacy_items' \| 'user_products'/);
  assert.match(source, /providerStockAuthority: 'item_available_quantity'/);
});

test('seller capability guard allows both publication models but fails closed on warehouse stock or material drift', async () => {
  const source = await readFile(capabilityGuardPath, 'utf8');
  assert.match(source, /inspectMercadoLivrePublicationCapability/);
  assert.match(source, /freezeMercadoLivrePublicationCapability/);
  assert.match(source, /currentSnapshot\.fingerprint !== expected\.fingerprint/);
  assert.match(source, /MERCADO_LIVRE_PUBLICATION_CAPABILITY_STALE/);
  assert.doesNotMatch(source, /currentSnapshot\.publicationModel !== 'legacy_items'/);
  assert.match(source, /currentSnapshot\.stockAuthority !== 'item_available_quantity'/);
  assert.match(source, /MERCADO_LIVRE_STOCK_LOCATION_PUBLICATION_ADAPTER_REQUIRED/);
  assert.doesNotMatch(source, /mercadoLivrePostJson|mercadoLivreValidateJson/);
});

test('listing validator requires conditional evidence from the same publication model', async () => {
  const source = await readFile(listingValidatorPath, 'utf8');
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_CONDITIONAL_VALIDATION_REQUIRED/);
  assert.match(source, /record\.ready !== true/);
  assert.match(source, /providerCapabilityFingerprint, 80\) !== proposal\.providerCapabilityFingerprint/);
  assert.match(source, /record\.providerPublicationModel !== proposal\.providerPublicationModel/);
  assert.match(source, /record\.providerStockAuthority !== proposal\.providerStockAuthority/);
  assert.match(source, /canonicalMatchesProposal/);
});

test('authenticated Mercado Livre helpers distinguish JSON POST from 204 listing validation', async () => {
  const source = await readFile(oauthPath, 'utf8');
  assert.match(source, /export const mercadoLivrePostJson/);
  assert.match(source, /export const mercadoLivreValidateJson/);
  assert.match(source, /response\.status === 204/);
  assert.match(source, /authorization: `Bearer \$\{secret\.accessToken\}`/);
  assert.match(source, /'content-type': 'application\/json'/);
});

test('outbound validation routes remain owner authenticated and separate from publication execution', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /validate-conditional-requirements/);
  assert.match(source, /validate-listing/);
  assert.match(source, /validateMercadoLivreOutboundConditionalRequirements/);
  assert.match(source, /validateMercadoLivreOutboundListing/);
  assert.match(source, /authenticatedOwner/);
  assert.doesNotMatch(source, /createMercadoLivreListing|publishMercadoLivre/);
});
