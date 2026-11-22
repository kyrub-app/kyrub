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
  assert.match(card, /Conferir pedidos e Pix de/);
  assert.match(card, /\(somente leitura\)/);
  assert.match(card, /snapshot\.items\.filter\(item => item\.canonicalStoreId && item\.readiness !== 'identity_review'\)/);
  assert.match(card, /runAudit\(item\.canonicalStoreId\)/);
  assert.match(card, /auditStoreId === item\.canonicalStoreId/);
  assert.doesNotMatch(card, /snapshot\.items\.length === 1/);
  assert.doesNotMatch(card, /method: 'POST'/);
});

test('order completion is not a paid event; local links distinguish pending and historical orders', async()=>{
 const {summarizeMerchantPixLinks}=await import('../server/admin/merchantPixLinkAuditPolicy.js');
 const rows=[
 {id:'o1',data:{status:'completed',paymentStatus:'unpaid',storeId:'store'}},
 {id:'o2',data:{status:'pending',paymentStatus:'unpaid',storeId:'store',paymentIntentId:'i',paymentId:'p'}},
 {id:'o3',data:{status:'completed',paymentStatus:'paid',storeId:'store'}},
 ];
 const intents=[{id:'i',data:{context:'marketplace',method:'pix',status:'pending',storeId:'store',target:{orderId:'o2'},providerIntentId:'mp',amount:10}}];
 const payments=[{id:'p',data:{context:'marketplace',method:'pix',status:'pending',storeId:'store',paymentIntentId:'i',orderId:'o2',providerPaymentId:'mp',amount:10}}];
 const summary=summarizeMerchantPixLinks({orders:rows,intents,payments,complete:true,storeId:'store',tenantId:'tenant'});
 assert.deepEqual(summary.orderStates,{paid:1,partial:0,unpaid:2,unknown:0,completed:2});
 assert.deepEqual(summary.pending,{intents:1,payments:1,withProviderId:1,completeTriples:1,needsReview:0});
 assert.equal(summary.paidOrderLinks.withoutExplicitPaymentId,1);
 assert.equal(summary.paidOrderLinks.linkedCanonicalPaid,0);
 assert.equal(JSON.stringify(summary).includes('"mp"'),false);
 const mismatch=summarizeMerchantPixLinks({orders:rows,intents,payments:[{...payments[0],data:{...payments[0].data,storeId:'another'}}],complete:false,storeId:'store',tenantId:'tenant'});
 assert.equal(mismatch.pending.completeTriples,0);
 assert.equal(mismatch.pending.needsReview,1);
 assert.equal(mismatch.complete,false);
});
