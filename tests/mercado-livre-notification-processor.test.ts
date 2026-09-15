import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  isMercadoLivreCommerciallyConfirmed,
  mercadoLivreOrderIdFromResource,
  normalizeMercadoLivrePaidOrderForKds,
  parseMercadoLivreOrderSnapshot,
} from '../shared/mercadoLivreOrderIngress.js';

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

test('manual catalog processor route remains owner scoped and is not wired directly into public webhook acknowledgement', () => {
  const router = readFileSync('server/integrations/mercadoLivreRouter.ts', 'utf8');
  assert.match(router, /\/:storeId\/notifications\/:inboxId\/process/);
  assert.match(router, /authenticatedOwner/);
  const webhook = router.match(/router\.post\('\/notifications'[\s\S]*?\n  \}\);/)?.[0] ?? '';
  assert.doesNotMatch(webhook, /processMercadoLivreOrderNotificationInboxItem/);
});

test('orders_v2 resource parser accepts only order resource paths', () => {
  assert.equal(
    mercadoLivreOrderIdFromResource('/orders/2000012345678901'),
    '2000012345678901'
  );
  assert.throws(
    () => mercadoLivreOrderIdFromResource('/items/MLB123'),
    /MERCADO_LIVRE_ORDER_RESOURCE_UNSUPPORTED/
  );
});

test('paid Mercado Livre order is normalized into the canonical KDS-compatible CustomerOrder shape', () => {
  const snapshot = parseMercadoLivreOrderSnapshot({
    id: 2000012345678901,
    status: 'paid',
    date_created: '2026-09-15T16:00:00.000Z',
    last_updated: '2026-09-15T16:01:00.000Z',
    seller: { id: 777 },
    buyer: { id: 888, first_name: 'Cliente', last_name: 'Teste' },
    shipping: { id: 999 },
    total_amount: 44,
    paid_amount: 44,
    order_items: [
      {
        item: { id: 'MLB7640119796', title: 'Chaveiro Kyrub' },
        quantity: 2,
        unit_price: 22,
      },
    ],
  }, '2000012345678901', '2026-09-15T16:02:00.000Z');

  assert.equal(isMercadoLivreCommerciallyConfirmed(snapshot), true);
  const order = normalizeMercadoLivrePaidOrderForKds({
    snapshot,
    tenantId: 'tenant-owner-1',
    canonicalStoreId: 'canonical-store-1',
    bindings: [{
      externalItemId: 'MLB7640119796',
      canonicalProductId: 'product-kyrub-1',
      canonicalStoreId: 'canonical-store-1',
    }],
  });

  assert.equal(order.id, 'mercado-livre-order-2000012345678901');
  assert.equal(order.status, 'pending');
  assert.equal(order.paymentStatus, 'paid');
  assert.equal(order.source, 'transfer');
  assert.equal(order.sourceChannel, 'mercado_livre');
  assert.equal(order.fulfillmentType, 'delivery');
  assert.equal(order.items[0]?.productId, 'product-kyrub-1');
  assert.equal(order.items[0]?.quantity, 2);
  assert.equal(order.items[0]?.price, 22);
  assert.equal(order.total, 44);
  assert.equal(order.integration.routingTarget, 'KDS');
  assert.equal(order.integration.authority, 'provider_api_refetch');
});

test('unpaid order cannot be normalized into the KDS and missing canonical binding fails closed', () => {
  const unpaid = parseMercadoLivreOrderSnapshot({
    id: 2000012345678902,
    status: 'payment_in_process',
    seller: { id: 777 },
    buyer: { id: 888 },
    total_amount: 22,
    paid_amount: 0,
    order_items: [{
      item: { id: 'MLB7640119796', title: 'Chaveiro Kyrub' },
      quantity: 1,
      unit_price: 22,
    }],
  }, '2000012345678902', '2026-09-15T16:02:00.000Z');
  assert.equal(isMercadoLivreCommerciallyConfirmed(unpaid), false);
  assert.throws(
    () => normalizeMercadoLivrePaidOrderForKds({
      snapshot: unpaid,
      tenantId: 'tenant-owner-1',
      canonicalStoreId: 'canonical-store-1',
      bindings: [],
    }),
    /MERCADO_LIVRE_ORDER_NOT_COMMERCIALLY_CONFIRMED/
  );

  const paid = { ...unpaid, providerStatus: 'paid' };
  assert.throws(
    () => normalizeMercadoLivrePaidOrderForKds({
      snapshot: paid,
      tenantId: 'tenant-owner-1',
      canonicalStoreId: 'canonical-store-1',
      bindings: [],
    }),
    /MERCADO_LIVRE_ORDER_PRODUCT_BINDING_REQUIRED:MLB7640119796/
  );
});

test('multi-item paid order is all-or-nothing when only some external items have canonical bindings', () => {
  const snapshot = parseMercadoLivreOrderSnapshot({
    id: 2000012345678910,
    status: 'paid',
    seller: { id: 777 },
    buyer: { id: 888 },
    total_amount: 52,
    paid_amount: 52,
    order_items: [
      {
        item: { id: 'MLB7640119796', title: 'Chaveiro Kyrub' },
        quantity: 1,
        unit_price: 22,
      },
      {
        item: { id: 'MLB7640119800', title: 'Tag Kyrub' },
        quantity: 1,
        unit_price: 30,
      },
    ],
  }, '2000012345678910', '2026-09-15T16:10:00.000Z');

  assert.throws(
    () => normalizeMercadoLivrePaidOrderForKds({
      snapshot,
      tenantId: 'tenant-owner-1',
      canonicalStoreId: 'canonical-store-1',
      bindings: [{
        externalItemId: 'MLB7640119796',
        canonicalProductId: 'product-kyrub-1',
        canonicalStoreId: 'canonical-store-1',
      }],
    }),
    /MERCADO_LIVRE_ORDER_PRODUCT_BINDING_REQUIRED:MLB7640119800/
  );
});

test('order ingress service dual-writes legacy plus canonical order without coupling to fiscal emission', () => {
  const source = readFileSync('server/integrations/mercadoLivreOrderIngressService.ts', 'utf8');
  assert.match(source, /artifacts\/\$\{tenantId\}\/public\/data\/customerOrders/);
  assert.match(source, /stores\/\$\{bindingResolution\.canonicalStoreId\}\/orders/);
  assert.match(source, /createdByRole: 'integration'/);
  assert.match(source, /source: 'orders_v2'/);
  assert.match(source, /blocked_product_binding/);
  assert.match(source, /provider_cancellation_review_required/);
  assert.doesNotMatch(source, /NFC-e|NF-e|NFS-e|SEFAZ|CFOP|CST|emissionAuthority/);
});

test('orders_v2 malformed resources are poison-safe before Queue publication and after Queue delivery', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  const ingress = readFileSync('server/integrations/mercadoLivreOrderQueueIngressRouter.ts', 'utf8');
  assert.match(queue, /mercadoLivreOrderIdFromResource\(notification\.resource\)/);
  assert.match(queue, /MERCADO_LIVRE_ORDER_RESOURCE_UNSUPPORTED/);
  assert.match(queue, /disposition: 'discarded_invalid_message'/);
  assert.match(ingress, /isMercadoLivreOrderQueueTerminalEnvelopeError/);
  assert.match(ingress, /received: true, ignored: true, code/);
  assert.match(ingress, /response\.status\(503\)\.json\(\{ received: false \}\)/);
});

test('Queue redelivery quarantines deterministic provider contract failures instead of retrying forever', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /MERCADO_LIVRE_ORDER_SELLER_MISMATCH/);
  assert.match(queue, /MERCADO_LIVRE_ORDER_RESPONSE_INVALID/);
  assert.match(queue, /MERCADO_LIVRE_ORDER_ITEMS_INVALID/);
  assert.match(queue, /processingStatus: 'failed'/);
  assert.match(queue, /processingOutcome: 'quarantined_terminal_error'/);
  assert.match(queue, /if \(isMercadoLivreOrderQueueTerminalProcessingError\(code\)\)/);
  assert.match(queue, /throw error;/);
});

test('fragmented notifications for the same order stay independent because Queue idempotency is notification-scoped', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /queueIdempotencyKey\(notification\.notificationId\)/);
  assert.doesNotMatch(queue, /queueIdempotencyKey\(.*externalOrderId/);

  const ingress = readFileSync('server/integrations/mercadoLivreOrderIngressService.ts', 'utf8');
  const providerFetch = ingress.indexOf('mercadoLivreGetJson<unknown>');
  const existingStateRead = ingress.indexOf('const existingStatus = currentOrderStatus');
  assert.ok(providerFetch >= 0 && existingStateRead > providerFetch);
  assert.match(ingress, /lastNotificationId: input\.inbox\.notificationId/);
});

test('late and concurrent notifications for one Mercado Livre order are serialized before canonical reconciliation', () => {
  const queue = readFileSync('server/integrations/mercadoLivreOrderQueueService.ts', 'utf8');
  assert.match(queue, /integrationOrderProcessingLeases/);
  assert.match(queue, /externalAccountId.*externalOrderId/s);
  assert.match(queue, /MERCADO_LIVRE_ORDER_PROCESSING_LEASE_BUSY/);
  assert.match(queue, /holderToken/);
  assert.match(queue, /startOrderProcessingLeaseHeartbeat/);
  assert.match(queue, /finally \{/);
  assert.match(queue, /releaseOrderProcessingLease/);

  const acquireAt = queue.indexOf('lease = await acquireOrderProcessingLease');
  const processAt = queue.indexOf('processMercadoLivreOrderNotificationInboxItem', acquireAt);
  assert.ok(acquireAt >= 0 && processAt > acquireAt);
});

test('a late notification never trusts its sent timestamp as order state and always refetches provider truth', () => {
  const inbox = readFileSync('server/integrations/mercadoLivreNotificationInboxService.ts', 'utf8');
  const ingress = readFileSync('server/integrations/mercadoLivreOrderIngressService.ts', 'utf8');
  assert.match(inbox, /sentAt: notification\.sentAt/);
  assert.match(ingress, /mercadoLivreGetJson<unknown>/);
  assert.match(ingress, /parseMercadoLivreOrderSnapshot\(fetched, externalOrderId, fetchedAt\)/);
  assert.doesNotMatch(ingress, /inbox\.sentAt/);
});

test('paid order without binding is durably blocked before any KDS normalization', () => {
  const ingress = readFileSync('server/integrations/mercadoLivreOrderIngressService.ts', 'utf8');
  const bindingStart = ingress.indexOf('const bindingResolution = await resolveOrderBindings');
  const normalizationStart = ingress.indexOf('const order = normalizeMercadoLivrePaidOrderForKds', bindingStart);
  assert.ok(bindingStart >= 0 && normalizationStart > bindingStart);
  const bindingGate = ingress.slice(bindingStart, normalizationStart);
  assert.match(bindingGate, /mercadoLivreOrderIngressBlocks/);
  assert.match(bindingGate, /status: 'product_binding_required'/);
  assert.match(bindingGate, /processingOutcome: 'blocked_product_binding'/);
  assert.match(bindingGate, /authority: 'manual_resolution_required'/);
  assert.match(bindingGate, /snapshot\.lines\.map\(line => line\.externalItemId\)/);
  assert.match(bindingGate, /allExternalItemIds/);
  assert.match(bindingGate, /resolvedExternalItemIds/);
  assert.match(bindingGate, /missingExternalItemIds/);
  assert.match(bindingGate, /bindingCompleteness: 'all_items_required'/);
});

test('binding recovery reopens the original provider inbox and never fabricates a replacement notification', () => {
  const recovery = readFileSync('server/integrations/mercadoLivreOrderIngressRecoveryService.ts', 'utf8');
  assert.match(recovery, /sourceNotificationId/);
  assert.match(recovery, /createHash\('sha256'\)\.update\(notificationId\)/);
  assert.match(recovery, /processingOutcome, 80\) !== 'blocked_product_binding'/);
  assert.match(recovery, /processingStatus: 'pending'/);
  assert.match(recovery, /recoveryAuthority: 'store_owner_binding_resolution'/);
  assert.match(recovery, /processMercadoLivreOrderNotificationInboxItem/);
  assert.match(recovery, /expectedStoreId: storeId/);
  assert.match(recovery, /retryLeaseUntil/);
  assert.doesNotMatch(recovery, /@vercel\/queue|\bsend\s*\(/);
  assert.doesNotMatch(recovery, /canonicalProductId/);
});

test('binding recovery performs one final official refetch and reconciles payment or cancellation races through the same inbox', () => {
  const recovery = readFileSync('server/integrations/mercadoLivreOrderIngressRecoveryService.ts', 'utf8');
  assert.match(recovery, /reconcileProviderChangeDuringRecovery/);
  assert.match(recovery, /mercadoLivreGetJson<unknown>/);
  assert.match(recovery, /parseMercadoLivreOrderSnapshot/);
  assert.match(recovery, /snapshot\.providerStatus === previousProviderStatus/);
  assert.match(recovery, /recoveryReconciliationAuthority: 'provider_api_final_refetch'/);
  assert.match(recovery, /processingStatus: 'pending'/);
  assert.match(recovery, /providerChangedDuringRecovery/);

  const finalRefetchAt = recovery.indexOf('const fetched = await mercadoLivreGetJson<unknown>');
  const reopenAt = recovery.indexOf("processingStatus: 'pending'", finalRefetchAt);
  const canonicalReprocessAt = recovery.indexOf('processMercadoLivreOrderNotificationInboxItem', reopenAt);
  assert.ok(finalRefetchAt >= 0 && reopenAt > finalRefetchAt && canonicalReprocessAt > reopenAt);
});

test('binding recovery endpoint is owner-only and accepts no browser-supplied binding or commercial evidence', () => {
  const router = readFileSync('server/integrations/mercadoLivreE2ETestRouter.ts', 'utf8');
  const start = router.indexOf("router.post('/:storeId/e2e/order-ingress-blocks/:orderId/retry-after-binding'");
  const end = router.indexOf('\n\n  return router;', start);
  assert.ok(start >= 0 && end > start);
  const route = router.slice(start, end);
  assert.match(route, /authenticatedOwner/);
  assert.match(route, /retryMercadoLivreOrderIngressAfterBinding/);
  assert.match(route, /requestedByUserId: identity\.uid/);
  assert.doesNotMatch(route, /request\.body/);
  assert.doesNotMatch(route, /canonicalProductId|paymentStatus|providerStatus/);
});
