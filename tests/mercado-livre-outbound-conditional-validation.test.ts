import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundConditionalValidationService.ts', import.meta.url);
const listingValidatorPath = new URL('../server/integrations/mercadoLivreOutboundListingValidationService.ts', import.meta.url);
const oauthPath = new URL('../server/integrations/mercadoLivreOauthService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('conditional required attributes are validated with the official provider endpoint', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivrePostJson/);
  assert.match(source, /\/categories\/\$\{encodeURIComponent\(proposal\.providerCategoryId\)\}\/attributes\/conditional/);
  assert.match(source, /required_attributes/);
  assert.match(source, /provider_api_conditional_validation/);
});

test('conditional validation sends the reviewed item shape but never publishes an item', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /title: proposal\.canonical\.name/);
  assert.match(source, /category_id: proposal\.providerCategoryId/);
  assert.match(source, /price: proposal\.canonical\.price/);
  assert.match(source, /available_quantity: proposal\.canonical\.stock/);
  assert.match(source, /buying_mode: 'buy_it_now'/);
  assert.match(source, /listing_type_id: proposal\.providerListingTypeId/);
  assert.doesNotMatch(source, /['"`]\/items['"`]/);
});

test('attribute requirements are ready only when normal and conditional attributes are satisfied', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /missingRequiredAttributeIds\.length === 0 && missingConditionalAttributeIds\.length === 0/);
  assert.match(source, /conditional_required_attributes/);
  assert.match(source, /executionStatus: 'not_authorized'/);
});

test('conditional validation rechecks canonical and requirement configuration freshness transactionally', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /canonicalMatchesProposal/);
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
  assert.doesNotMatch(source, /['"`]\/items['"`]\s*,\s*itemPayload/);
});

test('listing validator cannot run before successful conditional validation', async () => {
  const source = await readFile(listingValidatorPath, 'utf8');
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_CONDITIONAL_VALIDATION_REQUIRED/);
  assert.match(source, /record\.ready !== true/);
  assert.match(source, /requirementConfiguredAt/);
  assert.match(source, /canonicalMatchesProposal/);
  assert.match(source, /adminDb\.runTransaction/);
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
