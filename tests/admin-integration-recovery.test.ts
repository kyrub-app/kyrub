import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseMerchantPixMigrationInventory } from '../src/components/admin/AdminMercadoPagoMigrationInventoryCard';
import { mapPlatformEconomyError } from '../server/admin/platformEconomyRouter';

const read = (path: string) => readFileSync(path, 'utf8');

test('economicLedger sum aggregate index is declared as collection group composite', () => {
  const data = JSON.parse(read('firestore.indexes.json')) as { indexes: Array<{
    collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order: string }>
  }> };
  assert.ok(data.indexes.some(index =>
    index.collectionGroup === 'economicLedger' &&
    index.queryScope === 'COLLECTION_GROUP' &&
    index.fields.length === 2 &&
    index.fields[0]?.fieldPath === 'kind' &&
    index.fields[0]?.order === 'ASCENDING' &&
    index.fields[1]?.fieldPath === 'amountMinor' &&
    index.fields[1]?.order === 'ASCENDING'
  ));
});

test('missing index becomes readable 503 response without leaking Firebase URL', () => {
  const missing = Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. You can create it here: https://console.firebase.google.com/test'), { code: 9 });
  const result = mapPlatformEconomyError(missing);
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'PLATFORM_ECONOMY_INDEX_PENDING');
  assert.doesNotMatch(result.body.error, /https:\/\/|firebase\.google\.com/);
});

test('invalid or partial Mercado Pago inventory does not crash the render tree', () => {
  assert.throws(() => parseMerchantPixMigrationInventory({}), /inventário/i);
  assert.throws(() => parseMerchantPixMigrationInventory({ generatedAt: '', scanned: 1, complete: true, items: null, warnings: [], rolloutMode: 'disabled' }), /inventário/i);
  const valid = {
    generatedAt: '2026-10-21T22:35:22.582Z',
    scanned: 1,
    complete: true,
    rolloutMode: 'disabled',
    items: [{
      canonicalStoreId: 'store-1', tenantId: 'owner-1', storeName: 'Loja',
      connection: 'connected', providerAccountLast4: '6959',
      readiness: 'oauth_connected_rollout_pending',
    }],
    warnings: ['Conferir vendas históricas'],
  };
  const parsed = parseMerchantPixMigrationInventory(valid);
  assert.equal(parsed.items.length, 1);
  assert.equal(parsed.items[0]?.providerAccountLast4, '6959');
  assert.equal(parsed.complete, true);
  assert.throws(() => parseMerchantPixMigrationInventory({
    ...valid, items: [{ ...valid.items[0], readiness: 'unknown' }],
  }), /formato inesperado/i);
});

test('inventory malformed backend response identifies a safe field without crashing', () => {
  assert.throws(() => parseMerchantPixMigrationInventory({}), /\(items\)/);
  assert.throws(() => parseMerchantPixMigrationInventory({
    items: [], generatedAt: '2026-10-21T00:00:00Z',
    scanned: 0, complete: true, warnings: [], rolloutMode: 'unknown',
  }), /\(rolloutMode\)/);
  assert.throws(() => parseMerchantPixMigrationInventory({
    items: [], generatedAt: '2026-10-21T00:00:00Z',
    scanned: 0, complete: false, warnings: null, rolloutMode: 'disabled',
  }), /\(warnings\)/);
});

test('integration/fiscal/economy workspaces have local recovery boundaries', () => {
  const modules = read('src/components/admin/AdminModulesWorkspace.tsx');
  const root = read('src/components/admin/AdminControlPlaneRoot.tsx');
  const boundary = read('src/components/admin/AdminWorkspaceRecoveryBoundary.tsx');
  assert.match(modules, /AdminWorkspaceRecoveryBoundary section="Integrações & Infraestrutura"/);
  assert.match(modules, /AdminWorkspaceRecoveryBoundary section="Fiscal \/ Nota Fiscal"/);
  assert.match(root, /AdminWorkspaceRecoveryBoundary section="Economia da Plataforma"/);
  assert.match(boundary, /getDerivedStateFromError/);
  assert.match(boundary, /Tentar abrir esta seção novamente/);
  assert.doesNotMatch(boundary, /\.set\(\{|createMercadoPagoPixPayment|loadMercadoPagoStoreTokenSecret/);
});
