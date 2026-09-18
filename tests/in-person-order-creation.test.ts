import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseInPersonOrderCreateInput } from '../shared/inPersonOrder';

describe('authoritative in-person order creation', () => {
  test('request contract carries location identity and product intent only', () => {
    const parsed = parseInPersonOrderCreateInput({
      storeId: 'legacy-store-1',
      serviceLocationId: 'counter-2',
      customerLabel: ' Senha 24 ',
      customerNote: ' Sem pressa ',
      items: [
        { productId: 'product-1', quantity: 2, note: ' Sem gelo ' },
      ],
    });
    assert.deepEqual(parsed, {
      storeId: 'legacy-store-1',
      serviceLocationId: 'counter-2',
      customerLabel: 'Senha 24',
      customerNote: 'Sem pressa',
      items: [
        { productId: 'product-1', quantity: 2, note: 'Sem gelo' },
      ],
    });
    assert.throws(() => parseInPersonOrderCreateInput({
      storeId: 'legacy-store-1',
      serviceLocationId: 'counter-2',
      customerLabel: '',
      customerNote: '',
      items: [
        { productId: 'product-1', quantity: 1, note: '' },
        { productId: 'product-1', quantity: 1, note: '' },
      ],
    }), /DUPLICATED/);
  });

  test('server resolves canonical store, active location and canonical products before write', () => {
    const service = readFileSync('server/attendance/inPersonOrderService.ts', 'utf8');
    assert.match(service, /tenantCanonicalStoreId/);
    assert.match(service, /privateCanonicalStoreId/);
    assert.match(service, /IN_PERSON_ORDER_CANONICAL_CUTOVER_REQUIRED/);
    assert.match(service, /getServiceLocation\(\{/);
    assert.match(service, /requireActive: true/);
    assert.match(service, /stores\/\$\{input\.canonicalStoreId\}\/products\/\$\{line\.productId\}/);
    assert.match(service, /price: product\.price/);
    assert.match(service, /name: product\.name/);
    assert.doesNotMatch(service, /price:\s*line\./);
    assert.doesNotMatch(service, /name:\s*line\./);
  });

  test('staff order is canonical Kyrub commerce without customer identity or automatic settlement', () => {
    const service = readFileSync('server/attendance/inPersonOrderService.ts', 'utf8');
    assert.match(service, /buyerId: `local-order:\$\{orderId\}`/);
    assert.match(service, /buyerIdentityStatus: 'unverified_local'/);
    assert.match(service, /fulfillmentType: 'dine_in'/);
    assert.match(service, /source: 'staff'/);
    assert.match(service, /sourceChannel: 'kyrub'/);
    assert.match(service, /status: 'pending'/);
    assert.match(service, /paymentStatus: 'unpaid'/);
    assert.match(service, /operatorId: actorUserId/);
    assert.doesNotMatch(service, /storePointLedger|rewardRedemptions|invoice|notaFiscal|fiscalEmission|paymentIntent/i);
  });

  test('canonical and legacy order documents are born together in one server batch', () => {
    const service = readFileSync('server/attendance/inPersonOrderService.ts', 'utf8');
    assert.match(service, /LEGACY_ORDER_ROOT/);
    assert.match(service, /stores\/\$\{context\.canonicalStoreId\}\/orders\/\$\{orderId\}/);
    assert.match(service, /migration:\s*\{[\s\S]*mode: 'canonical_first'/);
    assert.match(service, /legacyCreatedAt: timestamp/);
    assert.match(service, /legacyUpdatedAt: timestamp/);
    assert.match(service, /const batch = adminDb\.batch\(\)/);
    assert.match(service, /batch\.create\(legacyReference/);
    assert.match(service, /batch\.create\(canonicalReference/);
    assert.match(service, /await batch\.commit\(\)/);
  });

  test('API derives operator authority from Firebase identity and store representation', () => {
    const router = readFileSync('server/attendance/inPersonOrderRouter.ts', 'utf8');
    const parent = readFileSync('server/attendance/localAttendanceRouter.ts', 'utf8');
    assert.match(router, /verifyFirebaseIdToken\(token\)/);
    assert.match(router, /loadOwnerStoreInstitutionalRepresentation/);
    assert.match(router, /authenticatedUserId: representation\.authenticatedUserId/);
    assert.doesNotMatch(router, /request\.body\?\.operatorId/);
    assert.match(parent, /router\.use\('\/orders', createInPersonOrderRouter\(\)\)/);
  });

  test('browser sends IDs, quantities and notes while server owns price, source and snapshot', () => {
    const client = readFileSync('src/utils/inPersonOrders.ts', 'utf8');
    const composer = readFileSync('src/components/store/InPersonOrderComposer.tsx', 'utf8');
    assert.match(client, /currentUser\(\)\.getIdToken\(\)/);
    assert.match(client, /\/api\/local-attendance\/orders/);
    assert.doesNotMatch(client, /setDoc|addDoc|writeBatch|collection\(db|doc\(db/);

    const callStart = composer.indexOf('const order = await createInPersonOrder');
    const callEnd = composer.indexOf('});', callStart) + 3;
    const payloadBlock = composer.slice(callStart, callEnd);
    assert.match(payloadBlock, /serviceLocationId: selectedLocationId/);
    assert.match(payloadBlock, /productId: product\.id/);
    assert.match(payloadBlock, /quantity/);
    assert.doesNotMatch(payloadBlock, /price\s*:/);
    assert.doesNotMatch(payloadBlock, /serviceLocation\s*:/);
    assert.doesNotMatch(payloadBlock, /operatorId\s*:/);
    assert.doesNotMatch(payloadBlock, /source\s*:/);
    assert.doesNotMatch(payloadBlock, /status\s*:/);
  });

  test('order creation does not become a second inventory authority', () => {
    const service = readFileSync('server/attendance/inPersonOrderService.ts', 'utf8');
    const composer = readFileSync('src/components/store/InPersonOrderComposer.tsx', 'utf8');
    const inventory = readFileSync('server/inventory/orderInventoryService.ts', 'utf8');
    assert.doesNotMatch(service, /line\.quantity\s*>\s*product\.stock/);
    assert.doesNotMatch(composer, /quantity\s*>=\s*product\.stock/);
    assert.match(composer, /Estoque exibido:/);
    assert.match(inventory, /resolvePhysicalInventoryAuthority/);
    assert.match(inventory, /applyInventoryForStatus/);
    assert.match(inventory, /shouldConsumeInventory/);
  });

  test('existing status authority keeps legacy and canonical copies aligned', () => {
    const inventory = readFileSync('server/inventory/orderInventoryService.ts', 'utf8');
    assert.match(inventory, /const canonicalStoreId = clean\(tenantSnapshot\.data\(\)\?\.canonicalStoreId\)/);
    assert.match(inventory, /transaction\.set\(\s*orderReference/);
    assert.match(
      inventory,
      /adminDb\.doc\(`stores\/\$\{canonicalStoreId\}\/orders\/\$\{normalizedOrderId\}`\)/
    );
    assert.match(inventory, /status: nextStatus/);
  });

  test('PDV mounts the composer and states the non-fiscal/non-payment boundary', () => {
    const bridge = readFileSync('src/components/store/LocalServicePdvBridge.tsx', 'utf8');
    const composer = readFileSync('src/components/store/InPersonOrderComposer.tsx', 'utf8');
    const workflow = readFileSync('src/utils/orderWorkflow.ts', 'utf8');
    assert.match(bridge, /<InPersonOrderComposer storeId=\{user\.uid\} \/>/);
    assert.match(composer, /O pedido nasce pendente/);
    assert.match(composer, /não confirma pagamento, emissão fiscal, identidade do cliente ou pontos/);
    assert.match(workflow, /if \(order\.source !== 'customer'\) return true/);
  });
});
