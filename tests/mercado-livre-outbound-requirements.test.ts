import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreOutboundRequirementsService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('outbound requirements come from authenticated Mercado Livre provider metadata', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivreGetJson/);
  assert.match(source, /\/users\/\$\{encodeURIComponent\(externalAccountId\)\}/);
  assert.match(source, /domain_discovery\/search\?limit=3/);
  assert.match(source, /\/categories\/\$\{encodeURIComponent\(categoryId\)\}/);
  assert.match(source, /\/attributes/);
  assert.match(source, /available_listing_types\?category_id=/);
  assert.match(source, /provider_api_refetch/);
});

test('category prediction is suggestion rather than silent category authority', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /categorySuggestions/);
  assert.match(source, /CATEGORY_NOT_PREDICTED/);
  assert.match(source, /provider_api_refetch_and_store_owner_selection/);
  assert.match(source, /configuredByUserId !== storeId/);
});

test('required attributes, listing type and condition must match current provider metadata', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /tags\?\.required === true/);
  assert.match(source, /tags\?\.new_required === true/);
  assert.match(source, /tags\?\.conditional_required === true/);
  assert.match(source, /allowedConditions\.includes\(condition\)/);
  assert.match(source, /LISTING_TYPE_UNAVAILABLE/);
  assert.match(source, /listing_allowed !== true/);
});

test('configuration re-reads canonical product and blocks a stale outbound proposal', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /stores\/\$\{proposal\.canonicalStoreId\}\/products\/\$\{proposal\.canonicalProductId\}/);
  assert.match(source, /canonicalMatchesProposal/);
  assert.match(source, /currentCanonicalDoc/);
  assert.match(source, /MERCADO_LIVRE_OUTBOUND_PROPOSAL_STALE/);
});

test('conditional required attributes keep the proposal non-ready until separately validated', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /conditionalAttributeIds\.length === 0/);
  assert.match(source, /conditional_required_attributes/);
  assert.match(source, /executionStatus: 'not_authorized'/);
  assert.doesNotMatch(source, /\/items['"`]/);
});

test('outbound requirement routes remain owner authenticated and separate from publication execution', async () => {
  const router = await readFile(routerPath, 'utf8');
  assert.match(router, /inspect-requirements/);
  assert.match(router, /configure-requirements/);
  assert.match(router, /inspectMercadoLivreOutboundRequirements/);
  assert.match(router, /configureMercadoLivreOutboundRequirements/);
  assert.match(router, /authenticatedOwner/);
  assert.doesNotMatch(router, /createMercadoLivreListing|publishMercadoLivre/);
});
