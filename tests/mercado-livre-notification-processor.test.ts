import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Mercado Livre notification processor re-fetches the item through tenant OAuth', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationProcessor.ts', 'utf8');
  assert.match(source, /mercadoLivreGetJson<unknown>/);
  assert.match(source, /`\/items\/\$\{encodeURIComponent\(externalItemId\)\}`/);
  assert.match(source, /authority: 'provider_api_refetch'/);
});

test('processor requires connected manual-review Store Connection before creating review material', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationProcessor.ts', 'utf8');
  assert.match(source, /connection\.provider !== 'mercado_livre'/);
  assert.match(source, /connection\.status !== 'connected'/);
  assert.match(source, /connection\.externalAccountId !== inbox\.externalAccountId/);
  assert.match(source, /connection\.syncAuthority !== 'manual_review'/);
});

test('processor writes immutable external snapshot and review proposal, not Kyrub product or inventory mutations', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationProcessor.ts', 'utf8');
  assert.match(source, /externalCatalogSnapshots/);
  assert.match(source, /catalogSyncProposals/);
  assert.match(source, /status: 'review_required'/);
  assert.match(source, /proposal: 'external_change_detected'/);
  assert.doesNotMatch(source, /catalogImportDrafts/);
  assert.doesNotMatch(source, /inventoryMovements|inventoryLedger|products\//);
});

test('processor marks inbox processed in the same transaction that creates snapshot and proposal', () => {
  const source = readFileSync('server/integrations/mercadoLivreNotificationProcessor.ts', 'utf8');
  const transaction = source.match(/await adminDb\.runTransaction[\s\S]*?\n  \}\);/)?.[0] ?? '';
  assert.match(transaction, /transaction\.create\(snapshotRef/);
  assert.match(transaction, /transaction\.create\(proposalRef/);
  assert.match(transaction, /transaction\.update\(inboxRef/);
  assert.match(transaction, /processingStatus: 'processed'/);
});

test('manual processor route is owner scoped and never wired into public webhook acknowledgement', () => {
  const router = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(router, /\/:storeId\/notifications\/:inboxId\/process/);
  assert.match(router, /authenticatedOwner/);
  const webhook = router.match(/router\.post\('\/notifications'[\s\S]*?\n  \}\);/)?.[0] ?? '';
  assert.doesNotMatch(webhook, /processMercadoLivreNotificationInboxItem/);
});
