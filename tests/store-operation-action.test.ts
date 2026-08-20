import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const facade = readFileSync('server/actions/actionExecutionFacade.ts', 'utf8');
const service = readFileSync('server/actions/storeOperationExecutionService.ts', 'utf8');
const contract = readFileSync('shared/storeOperationAction.ts', 'utf8');

test('store operation is routed through a dedicated authoritative executor', () => {
  assert.match(facade, /isKyrubStoreOperationExecutionRequest/);
  assert.match(facade, /executeAuthorizedKyrubStoreOperation/);
  assert.match(service, /verifyIdToken/);
  assert.match(service, /CONFIRMATION_REQUIRED/);
  assert.match(service, /STORE_STATUS_CHANGED/);
  assert.match(service, /runTransaction/);
  assert.match(service, /actionReceipts/);
});

test('operational status synchronizes private and canonical store only after confirmation', () => {
  assert.match(contract, /'open' \| 'delayed' \| 'closed'/);
  assert.match(service, /transaction\.set\(privateRef/);
  assert.match(service, /transaction\.set\(publicRef/);
  assert.match(service, /status: nextStatus/);
});

test('opening hours update only openingHours and never integration credentials', () => {
  assert.match(service, /operationalSettings: \{ openingHours: patch \}/);
  assert.doesNotMatch(service, /externalStoreId/);
  assert.doesNotMatch(service, /routingTarget/);
  assert.doesNotMatch(service, /receiveOrders/);
  assert.match(service, /opensAt === entry\.closesAt/);
});
