import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { legacyMercadoPagoStoreIdFromPrimaryOwner } from '../shared/mercadoPagoLegacyOwnerStoreScope';

const path = 'server/payments/storeMercadoPagoReconciliationRouter.ts';
const read = (file: string) => readFileSync(file, 'utf8');

test('owner-verified primary store fallback uses only the same persisted owner uid', () => {
  assert.equal(legacyMercadoPagoStoreIdFromPrimaryOwner('owner-1', {
    id: 'owner-1', ownerId: 'owner-1',
  }), 'owner-1');
  assert.equal(legacyMercadoPagoStoreIdFromPrimaryOwner('owner-1', {
    id: 'owner-1', ownerId: 'owner-1', legacyTenantId: 'owner-1',
  }), 'owner-1');
  for (const invalid of [
    null,
    { id: 'owner-1', ownerId: 'another-user' },
    { id: 'another-store', ownerId: 'owner-1' },
    { id: 'owner-1', ownerId: 'owner-1', legacyTenantId: 'different-tenant' },
    { id: '', ownerId: 'owner-1' },
  ]) {
    assert.throws(
      () => legacyMercadoPagoStoreIdFromPrimaryOwner('owner-1', invalid),
      /STORE_PROVIDER_RECONCILIATION_STORE_SCOPE_INVALID/
    );
  }
});

test('legacy migration mapping retains priority; primary owner is only verified fallback', () => {
  const router = read(path);
  const scope = router.split('const legacyStoreIdForCanonicalStore = async')[1]
    ?.split('const feeEvidence')[0] ?? '';
  assert.match(scope, /adminDb\.doc\(`stores\/\$\{canonicalStoreId\}`\)\.get\(\)/);
  assert.match(scope, /if \(snapshot\.exists\)/);
  assert.match(scope, /clean\(data\.ownerId\) !== legacyStoreId/);
  assert.match(scope, /getPrimaryUserStoreDocumentPath\(canonicalStoreId\)/);
  assert.match(scope, /legacyMercadoPagoStoreIdFromPrimaryOwner\(/);
  assert.ok(scope.indexOf('if (snapshot.exists)') < scope.indexOf('getPrimaryUserStoreDocumentPath'));
  assert.doesNotMatch(scope, /\.set\(|\.update\(|\.create\(|runTransaction/);
});

test('reconciliation remains owner gated and verifies provider collector before persistence', () => {
  const router = read(path);
  assert.match(router, /await requireOwner\(clean\(request\.headers\.authorization\), storeId\)/);
  assert.match(router, /binding\.canonicalStoreId !== storeId/);
  assert.match(router, /binding\.paymentId !== payment\.id/);
  assert.match(router, /!clean\(providerPayment\.collector_id\)/);
  assert.match(router, /clean\(providerPayment\.collector_id\) !== secret\.externalAccountId/);
  assert.match(router, /assertLegacyPlatformMercadoPagoPaymentScope\(/);
  assert.match(router, /const reconciliation = buildReconciliation\(\{ storeId, payment, providerPayment \}\)/);
  assert.match(router, /return saveReconciliation\(reconciliation\)/);
});

test('different 404 errors allow diagnosis without inventing a historical payment', () => {
  const router = read(path);
  assert.match(router, /STORE_PROVIDER_RECONCILIATION_PAYMENT_NOT_FOUND/);
  assert.match(router, /Documento original do pagamento não encontrado/);
  assert.match(router, /STORE_PROVIDER_RECONCILIATION_STORE_NOT_FOUND/);
  assert.match(router, /Cadastro da loja necessário à conciliação não encontrado/);
  assert.match(router, /const payment = await loadCanonicalPayment\(storeId, paymentId\)/);
  assert.doesNotMatch(router, /Pagamento ou loja não encontrado/);
});

test('ledger backfill badge never impersonates external MP reconciliation', () => {
  const client = read('src/components/store/StoreFinanceHistoryWorkspace.tsx');
  assert.match(client, /canonical_payment_snapshot: 'Recebimento recuperado do histórico'/);
  assert.match(client, /provider_webhook: 'Confirmado pelo provedor'/);
  assert.doesNotMatch(client, /canonical_payment_snapshot: 'Pagamento reconciliado'/);
});
