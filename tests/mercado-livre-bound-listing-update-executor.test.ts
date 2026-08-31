import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreBoundListingUpdateExecutionService.ts', import.meta.url);
const putHelperPath = new URL('../server/integrations/mercadoLivrePutJson.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('executor consumes update authorization before provider PUT', async () => {
  const source = await readFile(servicePath, 'utf8');
  const reserveIndex = source.indexOf("consumptionStatus: 'executing'");
  const putIndex = source.indexOf('mercadoLivrePutJson<ProviderItem>');
  assert.ok(reserveIndex >= 0);
  assert.ok(putIndex > reserveIndex);
  assert.match(source, /useCount: 1/);
  assert.match(source, /consumedByExecutionId/);
});

test('executor rechecks token, expiry, target canonical hash and provider observed hash', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /authorization\.expiresAtMillis <= Date\.now\(\)/);
  assert.match(source, /canonicalTargetHash/);
  assert.match(source, /providerObservedHash/);
  assert.match(source, /mercadoLivreGetJson<unknown>/);
});

test('provider update payload is restricted to title and price', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /key !== 'price' && key !== 'title'/);
  assert.doesNotMatch(source, /available_quantity\s*:/);
  assert.doesNotMatch(source, /category_id\s*:/);
  assert.doesNotMatch(source, /pictures\s*:/);
});

test('PUT helper uses official item update method', async () => {
  const source = await readFile(putHelperPath, 'utf8');
  assert.match(source, /method: 'PUT'/);
  assert.match(source, /Authorization|authorization/);
  assert.match(source, /JSON\.stringify\(body\)/);
});

test('ambiguous provider result is never retried automatically', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /reconciliation_required/);
  assert.match(source, /ambiguous_provider_result/);
  assert.match(source, /provider_success_identity_unverified/);
  assert.doesNotMatch(source, /setTimeout|retry|RETRY/);
});

test('definite provider 4xx rejection is distinct from ambiguous failure', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /status >= 400 && status < 500/);
  assert.match(source, /provider_rejected/);
  assert.match(source, /definite_provider_rejection/);
});

test('successful PUT does not advance binding baseline before authoritative reconciliation', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /provider_write_succeeded/);
  assert.doesNotMatch(source, /transaction\.update\(bindingRef/);
  assert.doesNotMatch(source, /externalCatalogBindingBaselines/);
});

test('owner-authenticated route executes an existing bound listing update', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-update-authorizations\/:authorizationId\/execute/);
  assert.match(source, /executeAuthorizedMercadoLivreBoundListingUpdate/);
  assert.match(source, /authorizationToken/);
  assert.match(source, /authenticatedOwner/);
});
