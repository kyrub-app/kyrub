import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('review service reads only Mercado Livre proposals that still require review', () => {
  const source = readFileSync('server/integrations/mercadoLivreSyncReviewService.ts', 'utf8');
  assert.match(source, /catalogSyncProposals/);
  assert.match(source, /where\('provider', '==', 'mercado_livre'\)/);
  assert.match(source, /where\('status', '==', 'review_required'\)/);
  assert.match(source, /externalCatalogSnapshots/);
  assert.match(source, /provider_api_refetch/);
});

test('merchant decision records review authority but does not apply catalog mutation', () => {
  const source = readFileSync('server/integrations/mercadoLivreSyncReviewService.ts', 'utf8');
  assert.match(source, /decisionAuthority: 'store_owner_review'/);
  assert.match(source, /applyStatus: 'not_applied'/);
  assert.doesNotMatch(source, /products\//);
  assert.doesNotMatch(source, /inventory/);
  assert.doesNotMatch(source, /publication/);
});

test('review routes are owner authenticated and separated from provider webhook', () => {
  const source = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(source, /\/:storeId\/sync-proposals/);
  assert.match(source, /\/:storeId\/sync-proposals\/:proposalId\/decision/);
  assert.match(source, /authenticatedOwner/);
  assert.match(source, /router\.post\('\/notifications'/);
});

test('merchant workspace mounts a visible Mercado Livre proposal queue', () => {
  const workspace = readFileSync('src/components/store/StoreConnectionsWorkspace.tsx', 'utf8');
  const queue = readFileSync('src/components/store/MercadoLivreSyncReviewQueue.tsx', 'utf8');
  assert.match(workspace, /MercadoLivreSyncReviewQueue/);
  assert.match(queue, /Mudanças detectadas no Mercado Livre/);
  assert.match(queue, /Aprovar/);
  assert.match(queue, /Rejeitar/);
  assert.match(queue, /ainda não altera produto, preço, estoque ou publicação no Kyrub/);
});

test('client decision API sends only explicit approve or reject choice', () => {
  const source = readFileSync('src/utils/storeConnections.ts', 'utf8');
  assert.match(source, /decision: 'approve' \| 'reject'/);
  assert.match(source, /sync-proposals\/\$\{encoded\(proposalId\)\}\/decision/);
  assert.match(source, /JSON\.stringify\(\{ decision \}\)/);
});
