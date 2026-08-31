import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('approved proposal apply targets only catalog import drafts', () => {
  const source = readFileSync('server/integrations/mercadoLivreApprovedProposalApplyService.ts', 'utf8');
  assert.match(source, /catalogImportDrafts/);
  assert.match(source, /applyTarget: 'catalog_import_draft'/);
  assert.match(source, /applyAuthority: 'approved_store_owner_review'/);
  assert.doesNotMatch(source, /products\//);
  assert.doesNotMatch(source, /inventoryMovements/);
  assert.doesNotMatch(source, /inventoryLedger/);
});

test('application requires an approved store owner review and immutable API snapshot', () => {
  const source = readFileSync('server/integrations/mercadoLivreApprovedProposalApplyService.ts', 'utf8');
  assert.match(source, /record\.status !== 'approved'/);
  assert.match(source, /record\.decisionAuthority !== 'store_owner_review'/);
  assert.match(source, /record\.authority !== 'provider_api_refetch'/);
  assert.match(source, /snapshot\.authority !== 'provider_api_refetch'/);
});

test('draft application blocks manual-edit and stale-snapshot overwrite', () => {
  const source = readFileSync('server/integrations/mercadoLivreApprovedProposalApplyService.ts', 'utf8');
  assert.match(source, /clean\(draft\.updatedAt\) !== clean\(draft\.provenance\.lastSyncedAt\)/);
  assert.match(source, /MERCADO_LIVRE_SYNC_DRAFT_CONFLICT/);
  assert.match(source, /lastSyncedAt\.localeCompare\(source\.fetchedAt\) > 0/);
  assert.match(source, /MERCADO_LIVRE_SYNC_PROPOSAL_STALE/);
});

test('merchant API separates approval from apply-to-draft', () => {
  const router = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(router, /sync-proposals\/:proposalId\/decision/);
  assert.match(router, /sync-proposals\/:proposalId\/apply-to-draft/);
  assert.match(router, /sync-proposals-approved/);
  assert.match(router, /authenticatedOwner/);
});

test('merchant UI makes draft target explicit and keeps canonical catalog unchanged', () => {
  const queue = readFileSync('src/components/store/MercadoLivreSyncReviewQueue.tsx', 'utf8');
  assert.match(queue, /Aplicar ao rascunho/);
  assert.match(queue, /Produto, estoque e publicação canônicos continuam inalterados/);
  assert.match(queue, /bloqueia a aplicação para evitar sobrescrita silenciosa/);
});
