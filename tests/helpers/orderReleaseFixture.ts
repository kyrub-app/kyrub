export const orderReleaseFixture = (now: string) => {
  const records = new Map<string, any>();
  const orderPath = "artifacts/seller/public/data/customerOrders/order";
  const intentPath = "stores/seller/paymentIntents/intent";
  const paymentPath = "stores/seller/payments/payment";
  const receiptPath = `paymentWebhookEvents/${Buffer.from("verified-event").toString("base64url")}`;
  const items = [{productId: 'product', name: 'Produto', quantity: 1, unitPrice: 20, total: 20}];
  records.set(orderPath, { id: 'order', storeId: 'seller', buyerId: 'buyer', status: 'accepted', paymentStatus: 'unpaid',
    releaseMode: 'pay_before_fulfillment', paymentIntentId: 'intent', paymentId: 'payment', total: 20,
    items: [{...items[0], lineId: 'line', price: 20, transferredQuantity: 0, paidQuantity: 0}] });
  records.set('tenants/seller', {canonicalStoreId: 'canonical'});
  records.set('stores/canonical', {ownerId: 'seller', legacyTenantId: 'seller'});
  records.set(intentPath, {id: 'intent', storeId: 'seller', buyerId: 'buyer', context: 'marketplace',
    target: {kind: 'marketplace_order_draft', orderId: 'order'}, status: 'paid', amount: 20,
    method: 'pix', provider: 'mercado-pago', providerIntentId: 'psp', currency: 'BRL', idempotencyKey: 'intent-key',
    createdAt: now, updatedAt: now, expiresAt: now,
    orderDraft: {draftId: 'order', storeId: 'seller', buyerId: 'buyer', buyerName: '', buyerEmail: '',
      fulfillmentType: 'pickup', deliveryAddress: '', customerNote: '', items, subtotal: 20, deliveryFee: 0, total: 20} });
  records.set(paymentPath, {id: 'payment', storeId: 'seller', orderId: 'order', buyerId: 'buyer', paymentIntentId: 'intent',
    amount: 20, currency: 'BRL', method: 'pix', context: 'marketplace', status: 'paid', provider: 'mercado-pago',
    providerPaymentId: 'psp', idempotencyKey: 'payment-key', createdAt: now, updatedAt: now, paidAt: now,
    refundedAt: '', verifiedEventKey: 'verified-event'});
  records.set(receiptPath, {idempotencyKey: 'verified-event', eventType: 'payment.paid', storeId: 'seller',
    paymentId: 'payment', paymentIntentId: 'intent', provider: 'mercado-pago', providerPaymentId: 'psp',
    amountMinor: 2000, currency: 'BRL', method: 'pix', occurredAt: now, recipientAccountId: 'collector'});
  return records;
};
