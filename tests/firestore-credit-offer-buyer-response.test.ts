import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adminDb } from '../server/firebaseAdmin.js';
import {
  proposeOrderCreditInterest,
  respondToOrderCreditInterest,
  loadOwnerCreditInterestProposal,
  listOwnCreditInterestProposals,
} from '../server/payments/orderCreditInterestService.js';
import { getPrimaryUserStoreDocumentPath } from '../src/utils/storePaths.js';

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) {
  throw new Error('LOCAL_FIRESTORE_EMULATOR_REQUIRED');
}

test('storewide credit consultation writes one offer and buyer notification, without changing the paid order', async () => {
  const storeId = 'credit_offer_store_emulated';
  const canonicalStoreId = 'credit_offer_canonical_emulated';
  const orderId = 'credit_offer_order_emulated';
  const buyerId = 'credit_offer_buyer_emulated';
  const paymentId = 'credit_offer_payment_emulated';
  const paymentPath = 'stores/' + storeId + '/payments/' + paymentId;
  const orderPath = 'artifacts/' + storeId + '/public/data/customerOrders/' + orderId;
  const canonicalPath = 'stores/' + canonicalStoreId;

  await Promise.all([
    adminDb.doc(getPrimaryUserStoreDocumentPath(storeId)).set({
      id: storeId, ownerId: storeId, name: 'Loja teste', status: 'open',
    }),
    adminDb.doc('tenants/' + storeId).set({canonicalStoreId}),
    adminDb.doc(canonicalPath).set({id: canonicalStoreId, ownerId: storeId, slug: 'teste-compensacao'}),
    adminDb.doc(orderPath).set({
      id: orderId, storeId, buyerId, createdByUserId: buyerId,
      status: 'rejected', paymentStatus: 'paid', refundStatus: 'required',
      total: 0, buyerName: 'Comprador fictício',
    }),
    adminDb.doc(paymentPath).set({
      id: paymentId, storeId, orderId, buyerId,
      paymentIntentId: 'credit_offer_intent_emulated',
      amount: 23.30, currency: 'BRL', method: 'pix', context: 'marketplace',
      status: 'paid', provider: 'mercado-pago',
      providerPaymentId: 'mp_credit_offer_emulated',
      idempotencyKey: 'credit_offer_payment_key',
      createdAt: '2026-11-22T17:00:00.000Z',
      updatedAt: '2026-11-22T17:01:00.000Z',
      paidAt: '2026-11-22T17:01:00.000Z',
      refundedAt: '',
    }),
  ]);
  const input = {storeId, orderId, actorId: storeId, bonusPercent: 20};
  const first = await proposeOrderCreditInterest(input);
  assert.equal(first.status, 'awaiting_response');
  assert.equal(first.amountMinor, 2330);
  assert.equal(first.bonusMinor, 466);
  assert.equal(first.proposedCreditMinor, 2796);
  assert.equal(first.scope, 'storewide');
  assert.equal(first.creditIssued, false);
  assert.equal(first.buyerId, buyerId);
  assert.deepEqual(await proposeOrderCreditInterest(input), first);

  const notificationSnap = await adminDb.collection('users/' + buyerId + '/notifications').get();
  assert.equal(notificationSnap.size, 1);
  assert.equal(notificationSnap.docs[0].get('category'), 'order');
  assert.equal(notificationSnap.docs[0].get('target.storeId'), canonicalStoreId);

  assert.deepEqual(await listOwnCreditInterestProposals({storeId: canonicalStoreId, buyerId}), [first]);
  assert.deepEqual(await listOwnCreditInterestProposals({storeId: canonicalStoreId, buyerId: 'someone_else'}), []);
  assert.deepEqual(await loadOwnerCreditInterestProposal({storeId, orderId, actorId: storeId}), first);
  await assert.rejects(
    loadOwnerCreditInterestProposal({storeId, orderId, actorId: 'someone_else'}),
    /STORE_REPRESENTATION_FORBIDDEN/
  );
  await assert.rejects(
    respondToOrderCreditInterest({storeId, orderId, buyerId: 'someone_else', choice: 'interested'}),
    /CREDIT_INTEREST_NOT_FOUND/
  );

  const interested = await respondToOrderCreditInterest({storeId, orderId, buyerId, choice: 'interested'});
  assert.equal(interested.status, 'interested');
  const prefersRefund = await respondToOrderCreditInterest({storeId, orderId, buyerId, choice: 'prefers_refund'});
  assert.equal(prefersRefund.status, 'prefers_refund');
  assert.equal((await adminDb.doc(paymentPath).get()).get('status'), 'paid');
  assert.equal((await adminDb.doc(orderPath).get()).get('refundStatus'), 'required');
  assert.equal((await adminDb.collection('users/' + buyerId + '/notifications').get()).size, 1);
  assert.equal((await adminDb.collection('stores/' + storeId + '/orderCreditInterestProposals').get()).size, 1);
  assert.equal((await adminDb.collection('stores/' + storeId + '/orderCreditBalances').get()).size, 0);
});

test('published first-store listing uses the owner UID while payments use a different canonical ID', async () => {
  const storeId='credit_first_store_owner';
  const canonicalStoreId='credit_first_store_canonical';
  const buyerId='credit_first_store_buyer';
  const orderId='credit_first_store_order';
  const paymentId='credit_first_store_payment';
  const listingPath='marketplace_listings/s_'+storeId.length+'_'+storeId;
  const paymentPath='stores/'+canonicalStoreId+'/payments/'+paymentId;
  const orderPath='artifacts/'+storeId+'/public/data/customerOrders/'+orderId;
  await Promise.all([
    adminDb.doc(getPrimaryUserStoreDocumentPath(storeId)).set({
      id:storeId,ownerId:storeId,canonicalStoreId,name:'Primeira loja',slug:'loja-compensacao-primeira',
    }),
    adminDb.doc('tenants/'+storeId).set({
      id:storeId,ownerId:storeId,publicationStatus:'published',
    }),
    adminDb.doc('stores/'+canonicalStoreId).set({
      id:canonicalStoreId,ownerId:storeId,legacyTenantId:storeId,
      firstStoreCreationVerified:true,publicationStatus:'published',
      // Intentionally no slug: published first-store public listing owns the slug.
    }),
    adminDb.doc(listingPath).set({
      listingId:'s_'+storeId.length+'_'+storeId,listingType:'store',
      storeId,ownerId:storeId,publicationStatus:'published',
      name:'Primeira loja',slug:'loja-compensacao-primeira',
    }),
    adminDb.doc(orderPath).set({
      id:orderId,storeId,buyerId,createdByUserId:buyerId,
      status:'rejected',paymentStatus:'paid',refundStatus:'required',
      total:0,buyerName:'Cliente fictício',
    }),
    adminDb.doc(paymentPath).set({
      id:paymentId,storeId:canonicalStoreId,orderId,buyerId,
      paymentIntentId:'first_store_intent',amount:23.30,currency:'BRL',
      method:'pix',context:'marketplace',status:'paid',provider:'mercado-pago',
      providerPaymentId:'mp_first_store_isolated',idempotencyKey:'first_store_key',
      createdAt:'2026-11-22T17:00:00.000Z',
      updatedAt:'2026-11-22T17:01:00.000Z',
      paidAt:'2026-11-22T17:01:00.000Z',refundedAt:'',
    }),
  ]);
  const input={storeId,orderId,actorId:storeId,bonusPercent:100};
  const proposal=await proposeOrderCreditInterest(input);
  assert.equal(proposal.canonicalStoreId,storeId,'public storefront ID');
  assert.equal(proposal.paymentStoreId,canonicalStoreId,'real canonical payment root');
  assert.equal(proposal.amountMinor,2330);
  assert.equal(proposal.bonusMinor,2330);
  assert.equal(proposal.proposedCreditMinor,4660);
  assert.equal(proposal.creditIssued,false);
  assert.deepEqual(await proposeOrderCreditInterest(input),proposal);
  assert.deepEqual(await listOwnCreditInterestProposals({storeId,buyerId}),[proposal]);
  assert.deepEqual(await listOwnCreditInterestProposals({
    storeId,buyerId:'credit_first_store_unrelated',
  }),[]);
  const notices=await adminDb.collection('users/'+buyerId+'/notifications').get();
  assert.equal(notices.size,1);
  assert.equal(notices.docs[0].get('target.storeId'),storeId);
  assert.equal(notices.docs[0].get('target.storeSlug'),'loja-compensacao-primeira');
  assert.equal((await adminDb.doc(paymentPath).get()).get('status'),'paid');
  assert.equal((await adminDb.doc(orderPath).get()).get('refundStatus'),'required');
  assert.equal((await adminDb.collection('stores/'+storeId+'/orderCreditBalances').get()).size,0);
  const interested=await respondToOrderCreditInterest({
    storeId,orderId,buyerId,choice:'interested',
  });
  assert.equal(interested.status,'interested');
  assert.equal(interested.creditIssued,false);
});

test('unverified first-store listing owner or paused publication blocks consultation', async () => {
  const storeId='credit_first_bad_owner';
  const canonicalStoreId='credit_first_bad_canonical';
  const orderId='credit_first_bad_order';
  const listingPath='marketplace_listings/s_'+storeId.length+'_'+storeId;
  await Promise.all([
    adminDb.doc(getPrimaryUserStoreDocumentPath(storeId)).set({
      id:storeId,ownerId:storeId,canonicalStoreId,name:'Loja inválida isolada',
    }),
    adminDb.doc('stores/'+canonicalStoreId).set({
      id:canonicalStoreId,ownerId:storeId,legacyTenantId:storeId,
      firstStoreCreationVerified:true,publicationStatus:'published',
    }),
    adminDb.doc(listingPath).set({
      listingType:'store',storeId,ownerId:'unrelated_user',
      publicationStatus:'published',slug:'loja-com-identidade-invalida',
    }),
  ]);
  const input={storeId,orderId,actorId:storeId,bonusPercent:100};
  await assert.rejects(proposeOrderCreditInterest(input),/CREDIT_INTEREST_STORE_UNVERIFIED/);
  await adminDb.doc(listingPath).update({ownerId:storeId,publicationStatus:'paused'});
  await assert.rejects(proposeOrderCreditInterest(input),/CREDIT_INTEREST_STORE_UNVERIFIED/);
  assert.equal((await adminDb.collection('stores/'+storeId+'/orderCreditInterestProposals').get()).size,0);
});
