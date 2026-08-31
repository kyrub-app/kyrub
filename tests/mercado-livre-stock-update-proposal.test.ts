import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  'server/integrations/mercadoLivreStockUpdateProposalService.ts',
  'utf8'
);

test('Mercado Livre stock proposal consumes a frozen channel availability snapshot', () => {
  assert.match(source, /channelAvailabilitySnapshotId/);
  assert.match(source, /channelAvailabilitySnapshots/);
  assert.match(source, /channel !== 'mercado_livre'/);
  assert.match(source, /kyrub_inventory_reservation_policy_snapshot/);
  assert.match(source, /publishableUnits/);
  assert.match(source, /sourceFingerprint/);
  assert.match(source, /policyRevision/);
});

test('stock proposal validates durable binding identity and canonical product scope', () => {
  assert.match(source, /externalCatalogBindings/);
  assert.match(source, /binding\.canonicalStoreId/);
  assert.match(source, /binding\.canonicalProductId/);
  assert.match(source, /inventoryAuthorityOwnerUserId/);
  assert.match(source, /MERCADO_LIVRE_STOCK_AVAILABILITY_SNAPSHOT_CONFLICT/);
});

test('provider stock is re-fetched and seller/item identity is verified', () => {
  assert.match(source, /mercadoLivreGetJson/);
  assert.match(source, /`\/items\/\$\{encodeURIComponent\(binding\.externalItemId\)\}`/);
  assert.match(source, /sellerId !== connection\.externalAccountId/);
  assert.match(source, /MERCADO_LIVRE_BOUND_LISTING_IDENTITY_MISMATCH/);
  assert.match(source, /providerObservedHash/);
});

test('user product stock mode is inspected before proposing provider writes', () => {
  assert.match(source, /user_product_id/);
  assert.match(source, /`\/user-products\/\$\{encodeURIComponent\(userProductId\)\}\/stock`/);
  assert.match(source, /seller_warehouse/);
  assert.match(source, /meli_facility/);
  assert.match(source, /selling_address/);
});

test('multi-origin inventory is blocked until warehouse allocation authority exists', () => {
  assert.match(source, /warehouse_allocation_policy_required/);
  assert.match(source, /blocked_provider_stock_mode/);
  assert.match(source, /user_product_seller_warehouse/);
});

test('provider-managed Full inventory is not treated as Kyrub-editable stock', () => {
  assert.match(source, /provider_managed_full/);
  assert.match(source, /provider_managed_inventory/);
});

test('simple inventory can only create a review proposal and never performs PUT', () => {
  assert.match(source, /item_available_quantity/);
  assert.match(source, /review_required/);
  assert.match(source, /executionStatus: 'not_authorized'/);
  assert.match(source, /catalogOutboundStockProposals/);
  assert.doesNotMatch(source, /mercadoLivrePutJson/);
  assert.doesNotMatch(source, /method:\s*['"]PUT['"]/);
  assert.doesNotMatch(source, /available_quantity\s*:/);
});

test('proposal target comes from publishable projection, never provider quantity', () => {
  assert.match(source, /targetAvailableQuantity: availability\.publishableUnits/);
  assert.match(source, /observedAvailableQuantity/);
  assert.doesNotMatch(source, /targetAvailableQuantity:\s*observedAvailableQuantity/);
});
