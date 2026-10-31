import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const read = (p: string) => readFileSync(p, 'utf8');

test('payment audit is scoped, bounded and read-only with an inventory identity check', () => {
  const source = read('server/admin/mercadoPagoMerchantPixPaymentAuditService.ts');
  assert.match(source, /loadMercadoPagoMerchantPixMigrationInventory\(\)/);
  assert.match(source, /inventory\.complete/);
  assert.match(source, /row\.canonicalStoreId === requestedStoreId/);
  assert.match(source, /MAX_PER_COLLECTION \+ 1/);
  assert.match(source, /artifacts\/\$\{tenantId\}\/public\/data\/customerOrders/);
  assert.match(source, /stores\/\$\{requestedStoreId\}\/paymentIntents/);
  assert.match(source, /stores\/\$\{requestedStoreId\}\/payments/);
  assert.doesNotMatch(source, /collectionGroup\(|\.set\(|\.update\(|\.delete\(|runTransaction|accessToken|refreshToken/);
});

test('production and local audit routes require super admin and allow GET only', () => {
  const prod = read('api/admin/operations/health.ts');
  const server = read('server/admin/operationsHealthRouter.ts');
  assert.match(prod, /transport === 'mercado-pago-store-payment-audit'/);
  assert.match(prod, /authorizeIntegrationReadiness\(authorization\)/);
  assert.match(prod, /loadMerchantPixStorePaymentAudit\(headerValue\(request\.query\?\.storeId\)\)/);
  assert.match(prod, /method !== 'GET'/);
  assert.match(server, /loadMerchantPixStorePaymentAudit\(clean\(request\.query\.storeId\)\)/);
  assert.match(server, /authorizeIntegrationReadiness\(request\.get\('authorization'\) \?\? ''\)/);
  const card = read('src/components/admin/AdminMercadoPagoMigrationInventoryCard.tsx');
  assert.match(card, /Conferir pedidos e Pix \(somente leitura\)/);
  assert.match(card, /snapshot\.items\.filter\(item => item\.canonicalStoreId && item\.readiness !== 'identity_review'\)/);
  assert.match(card, /runAudit\(item\.canonicalStoreId\)/);
  assert.match(card, /auditStoreId === item\.canonicalStoreId/);
  assert.doesNotMatch(card, /snapshot\.items\.length === 1/);
  assert.doesNotMatch(card, /method: 'POST'/);
});
