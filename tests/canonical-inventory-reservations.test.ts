import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  'server/inventory/canonicalInventoryReservationService.ts',
  'utf8'
);

test('resolves inventory authority from exactly one active canonical store owner', () => {
  assert.match(source, /stores\/\$\{storeId\}\/members/);
  assert.match(source, /where\('role', '==', 'owner'\)/);
  assert.match(source, /data\.status === 'active'/);
  assert.match(source, /activeOwners\.length !== 1/);
  assert.match(source, /INVENTORY_AUTHORITY_OWNER_UNRESOLVED/);
  assert.match(source, /users\/\$\{ownerUserId\}\/private_store\/inventory/);
  assert.match(source, /inventoryAuthorityOwnerUserId/);
  assert.match(source, /inventoryAuthority: 'active_store_owner_member'/);
});

test('reserves component inventory transactionally and idempotently per order/channel', () => {
  assert.match(source, /createHash\('sha256'\)/);
  assert.match(source, /storeId}:\$\{sourceChannel}:\$\{orderId}/);
  assert.match(source, /runTransaction/);
  assert.match(source, /where\('status', '==', 'active'\)/);
  assert.match(source, /buildInventoryReservationLines/);
  assert.match(source, /INVENTORY_AVAILABLE_TO_PROMISE_EXCEEDED/);
  assert.match(source, /transaction\.create\(reservationReference/);
  assert.match(source, /alreadyReserved: true/);
});

test('reservation lifecycle does not release consumed ATP without physical-consumption evidence', () => {
  assert.match(source, /nextStatus: Exclude<InventoryReservationStatus, 'active'>/);
  assert.match(source, /input\.nextStatus === 'consumed' && !evidenceId/);
  assert.match(source, /INVENTORY_PHYSICAL_CONSUMPTION_EVIDENCE_REQUIRED/);
  assert.match(source, /physicalConsumptionEvidenceId/);
  assert.match(source, /INVENTORY_RESERVATION_TERMINAL_CONFLICT/);
});

test('reservation service does not publish marketplace stock or issue fiscal documents', () => {
  assert.doesNotMatch(source, /mercadoLivrePutJson|\/items\//);
  assert.doesNotMatch(source, /available_quantity/);
  assert.doesNotMatch(source, /99food.*stock|stock.*99food/i);
  assert.doesNotMatch(source, /emit.*(?:nfe|nfce|nfse)|authorize.*(?:nfe|nfce|nfse)/i);
});
