import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const servicePath = new URL('../server/integrations/mercadoLivreBoundListingUpdateAuthorizationService.ts', import.meta.url);
const routerPath = new URL('../server/integrations/mercadoLivreRouter.ts', import.meta.url);

test('bound listing update authorization freezes only title and price changes', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /payload\.title = name/);
  assert.match(source, /payload\.price = price/);
  assert.doesNotMatch(source, /payload\.available_quantity/);
  assert.doesNotMatch(source, /payload\.category_id/);
  assert.doesNotMatch(source, /payload\.pictures/);
  assert.doesNotMatch(source, /payload\.status/);
});

test('authorization rechecks provider identity and observed hash before granting authority', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /mercadoLivreGetJson<unknown>\(storeId, `\/items\/\$\{encodeURIComponent\(proposal\.externalItemId\)\}`\)/);
  assert.match(source, /sellerId !== externalAccountId/);
  assert.match(source, /currentProviderHash !== proposal\.providerObservedHash/);
});

test('authorization rechecks active binding and canonical baseline transactionally', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /transaction\.get\(bindingRef\)/);
  assert.match(source, /transaction\.get\(canonicalRef\)/);
  assert.match(source, /canonicalMatchesProposal/);
  assert.match(source, /currentProposal\.canonicalBaselineHash !== proposal\.canonicalBaselineHash/);
});

test('authorization token is one-use, short-lived and only its hash is persisted', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.match(source, /randomBytes\(32\)\.toString\('base64url'\)/);
  assert.match(source, /tokenHash/);
  assert.match(source, /consumptionStatus: 'available'/);
  assert.match(source, /useCount: 0/);
  assert.match(source, /Date\.now\(\) \+ 15 \* 60 \* 1000/);
  const createBlock = source.slice(source.indexOf('transaction.create(authorizationRef'), source.indexOf('transaction.update(proposalRef'));
  assert.doesNotMatch(createBlock, /authorizationToken/);
});

test('authorization cut performs no Mercado Livre update write', async () => {
  const source = await readFile(servicePath, 'utf8');
  assert.doesNotMatch(source, /mercadoLivrePutJson/);
  assert.doesNotMatch(source, /method:\s*['"]PUT['"]/);
  assert.doesNotMatch(source, /POST \/items/);
});

test('owner-authenticated route exposes explicit update authorization', async () => {
  const source = await readFile(routerPath, 'utf8');
  assert.match(source, /outbound-update-proposals\/:proposalId\/authorize/);
  assert.match(source, /authorizeMercadoLivreBoundListingUpdate/);
  assert.match(source, /authenticatedOwner/);
});
