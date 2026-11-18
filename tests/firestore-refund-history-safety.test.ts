import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { adminDb } from '../server/firebaseAdmin';
import { cancelOrderItemsWithRefund } from '../server/payments/orderItemCancellationService';
import {
  getConfirmedPartialRefundSummary,
  assertFullRefundHasNoConfirmedPartialHistory,
} from '../server/payments/partialRefundSafetyService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('REFUND_HISTORY_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
process.env.GCLOUD_PROJECT = 'kyrub-security-test';

const storeId = 'refund_guard_shop';
const partials = (orderId: string) =>
  adminDb.collection('stores/' + storeId + '/paymentPartialRefunds');

test('paid partial cancellation atomically creates an unresolved refund marker before any provider request', async () => {
  const orderId = 'refund_guard_partial_before_provider';
  const operationId = 'partial_refund_guard_1';
  const orderRef = adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + orderId);
  await orderRef.set({
    id:orderId,storeId,status:'pending',paymentStatus:'paid',
    total:40,subtotal:40,items:[
      {lineId:'item_one',productId:'p1',name:'Produto 1',quantity:2,price:10},
      {lineId:'item_two',productId:'p2',name:'Produto 2',quantity:2,price:10},
    ],
  });
  // No payment provider fixture exists. The ERP mutation still has to make
  // the partial-refund dependency visible atomically and fail closed.
  const input = {
    storeId,orderId,operationId,
    reason:'Cancelamento parcial em ambiente isolado',
    selections:[{lineId:'item_one',quantity:1}],
  };
  const result = await cancelOrderItemsWithRefund(input);
  assert.equal(result.refundRequired,true);
  assert.equal(result.refundStatus,'required');
  assert.equal(result.cancelledAmount,10);
  const marker = await adminDb.doc(
    'stores/' + storeId + '/paymentPartialRefunds/' + operationId
  ).get();
  assert.equal(marker.data()?.orderId,orderId);
  assert.equal(marker.data()?.status,'required');
  assert.equal(marker.data()?.amount,10);
  await assert.rejects(
    assertFullRefundHasNoConfirmedPartialHistory({storeId,orderId}),
    /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/
  );
  const duplicate = await cancelOrderItemsWithRefund(input);
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.refundStatus,'required');
  assert.equal((await partials(orderId).where('orderId','==',orderId).get()).size,1);
});

test('any unresolved, failed or unknown partial provider state blocks an integral refund', async () => {
  for (const status of ['processing','failed','unrecognized'] as const) {
    const orderId = 'refund_guard_' + status;
    await partials(orderId).doc('partial_'+status).set({
      orderId,amount:7.25,status,
    });
    const summary = await getConfirmedPartialRefundSummary({storeId,orderId});
    assert.equal(summary.unresolvedCount,1);
    assert.equal(summary.count,0);
    await assert.rejects(
      assertFullRefundHasNoConfirmedPartialHistory({storeId,orderId}),
      /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/
    );
  }
});

test('a confirmed partial refund remains blocked from automatic full refund', async () => {
  const orderId='refund_guard_confirmed';
  await partials(orderId).doc('confirmed').set({
    orderId,status:'refunded',amount:4.99,
  });
  const summary=await getConfirmedPartialRefundSummary({storeId,orderId});
  assert.equal(summary.count,1);
  assert.equal(summary.amount,4.99);
  assert.equal(summary.unresolvedCount,0);
  await assert.rejects(
    assertFullRefundHasNoConfirmedPartialHistory({storeId,orderId}),
    /PAYMENT_REFUND_PARTIAL_HISTORY_REQUIRES_RESIDUAL/
  );
});

test('a truncated history of 51 attempts cannot be mistaken for no previous refunds', async () => {
  const orderId='refund_guard_history_51';
  const batch=adminDb.batch();
  for(let i=0;i<51;i++){
    batch.set(partials(orderId).doc('attempt_'+String(i).padStart(3,'0')),
      {orderId,status:'failed',amount:1});
  }
  await batch.commit();
  await assert.rejects(
    getConfirmedPartialRefundSummary({storeId,orderId}),
    /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/
  );
  await assert.rejects(
    assertFullRefundHasNoConfirmedPartialHistory({storeId,orderId}),
    /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/
  );
});

test('no partial-refund history is eligible for full-refund preflight; financial writes remain separate', async () => {
  const orderId='refund_guard_clean_history';
  assert.deepEqual(await getConfirmedPartialRefundSummary({storeId,orderId}),
    {count:0,amount:0,unresolvedCount:0});
  await assert.doesNotReject(
    assertFullRefundHasNoConfirmedPartialHistory({storeId,orderId})
  );
  const service=readFileSync('server/payments/paymentRefundService.ts','utf8');
  const router=readFileSync('server/payments/storePaymentRefundRouter.ts','utf8');
  const cancellation=readFileSync('server/payments/orderItemCancellationService.ts','utf8');
  assert.match(service,/await assertFullRefundHasNoConfirmedPartialHistory\(\{ storeId, orderId \}\)/);
  assert.match(router,/assertFullRefundHasNoConfirmedPartialHistory\(\{ storeId, orderId \}\)/);
  assert.match(cancellation,/transaction\.create\(\s*adminDb\.doc\(partialRefundPath/);
});


// Exercise both serial orders of the paid-order refund boundary with the real
// Firestore emulator. No PSP credentials or HTTP mock are needed: both cases
// stop before provider issuance. A successful full refund remains a distinct
// provider E2E gate and is never inferred from this test.
test('the two refund terminalization orders are mutually exclusive in Firestore', async () => {
  const paidOrder = (orderId: string) => ({
    id: orderId, storeId, status: 'pending', paymentStatus: 'paid',
    total: 40, subtotal: 40, items: [
      { lineId: 'first', productId: 'p1', name: 'Produto 1', quantity: 2, price: 10 },
      { lineId: 'second', productId: 'p2', name: 'Produto 2', quantity: 2, price: 10 },
    ],
  });
  const endOrder = async (orderId: string) => {
    const ref = adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + orderId);
    await adminDb.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      assert.equal(snapshot.get('status'), 'pending');
      transaction.update(ref, { status: 'cancelled' });
    });
  };

  // Partial wins: it commits the order mutation and the unresolved refund
  // marker together. An eventual terminal state cannot permit full refund.
  const partialFirstId = 'refund_race_partial_first';
  const partialFirstRef = adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + partialFirstId);
  await partialFirstRef.set(paidOrder(partialFirstId));
  const partial = await cancelOrderItemsWithRefund({
    storeId, orderId: partialFirstId, operationId: 'refund_race_partial_op',
    reason: 'Cancelamento parcial antes de encerrar',
    selections: [{ lineId: 'first', quantity: 1 }],
  });
  assert.equal(partial.refundRequired, true);
  assert.equal(partial.refundStatus, 'required');
  assert.equal((await partials(partialFirstId).doc('refund_race_partial_op').get()).get('status'), 'required');
  await endOrder(partialFirstId);
  await assert.rejects(
    assertFullRefundHasNoConfirmedPartialHistory({ storeId, orderId: partialFirstId }),
    /PAYMENT_REFUND_PARTIAL_HISTORY_REVIEW_REQUIRED/
  );

  // Terminal wins: after a full-refund preflight sees a terminal paid order,
  // the partial operation must fail in its own Firestore transaction without
  // creating an economic marker or contacting the PSP.
  const terminalFirstId = 'refund_race_terminal_first';
  const terminalFirstRef = adminDb.doc('artifacts/' + storeId + '/public/data/customerOrders/' + terminalFirstId);
  await terminalFirstRef.set(paidOrder(terminalFirstId));
  await endOrder(terminalFirstId);
  await assert.doesNotReject(
    assertFullRefundHasNoConfirmedPartialHistory({ storeId, orderId: terminalFirstId })
  );
  await assert.rejects(
    cancelOrderItemsWithRefund({
      storeId, orderId: terminalFirstId, operationId: 'refund_race_terminal_op',
      reason: 'Cancelamento parcial tardio',
      selections: [{ lineId: 'first', quantity: 1 }],
    }),
    /ORDER_ITEM_CANCELLATION_ORDER_NOT_PENDING/
  );
  assert.equal((await terminalFirstRef.get()).get('status'), 'cancelled');
  assert.equal((await partials(terminalFirstId).where('orderId', '==', terminalFirstId).get()).empty, true);
  assert.equal((await adminDb.doc('stores/' + storeId + '/paymentRefunds/refund_race_terminal_op').get()).exists, false);
});
