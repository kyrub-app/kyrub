import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const commandPath = new URL('../server/ai/kyrubiaMercadoLivreBoundListingUpdateAuthorizationCommand.ts', import.meta.url);
const platformConversationPath = new URL('../server/ai/kyrubiaMercadoLivrePlatformConversation.ts', import.meta.url);

test('Kyrubia bound update authorization requires proposal, item, exact price transition and price-only language', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /mlupd_\[a-f0-9\]/);
  assert.match(source, /MLB\\d/);
  assert.match(source, /de\\s\+R\\\$/);
  assert.match(source, /para\\s\+R\\\$/);
  assert.match(source, /exclusivamente\|somente\|apenas/);
  assert.match(source, /fromPrice === toPrice/);
});

test('generic confirmations never satisfy the critical external-update parser', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /EXPLICIT_AUTHORIZATION_REQUIRED/);
  assert.match(source, /“Sim”, “ok”, “pode”/);
  assert.match(source, /isKyrubiaMercadoLivreBoundUpdateAuthorizationCandidate/);
  assert.doesNotMatch(source, /message\.trim\(\).*===\s*['"]sim['"]/);
});

test('server rebinds the command to the stored proposal scope before authorizing', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /proposal\.id !== command\.proposalId/);
  assert.match(source, /proposal\.externalItemId !== command\.externalItemId/);
  assert.match(source, /proposal\.changedFields\.length === 1 && proposal\.changedFields\[0\] === 'price'/);
  assert.match(source, /proposedPrice !== command\.toPrice/);
  assert.match(source, /observedPrice !== command\.fromPrice/);
  assert.match(source, /\['stock', 'category', 'image', 'publicationStatus'\]/);
});

test('authorization, execution and reconciliation reuse the existing guarded services', async () => {
  const source = await readFile(commandPath, 'utf8');
  assert.match(source, /authorizeMercadoLivreBoundListingUpdate/);
  assert.match(source, /executeAuthorizedMercadoLivreBoundListingUpdate/);
  assert.match(source, /reconcileMercadoLivreBoundListingUpdate/);
  assert.match(source, /authorizationToken: authorization\.authorizationToken/);
  assert.match(source, /reconciliation_required/);
  assert.match(source, /não farei retry cego/);
});

test('bound update authorization is routed outside the new-publication continuation context', async () => {
  const source = await readFile(platformConversationPath, 'utf8');
  const continuation = source.slice(source.indexOf('export const shouldRouteKyrubiaMercadoLivrePlatformContinuation'));
  assert.match(continuation, /isKyrubiaMercadoLivreBoundUpdateAuthorizationCandidate\(input\.message\)\) return false/);
  const preparation = source.slice(
    source.indexOf('export const prepareKyrubiaMercadoLivrePlatformConversation'),
    source.indexOf('const exactLateGate')
  );
  assert.match(preparation, /handleKyrubiaMercadoLivreBoundUpdateAuthorizationCommand/);
  assert.ok(
    preparation.indexOf('handleKyrubiaMercadoLivreBoundUpdateAuthorizationCommand') <
    preparation.indexOf('extractKyrubiaMercadoLivrePreparationTarget'),
    'bound-update authorization must be checked before new-publication preparation'
  );
});
