import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../server/firebaseAdmin';
import {
  getDeliveryReturnLiabilityReview,
  proposeDeliveryReturnLiabilityReview,
  reviewDeliveryReturnLiability,
} from '../server/delivery/deliveryReturnLiabilityReviewService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('DELIVERY_RETURN_LIABILITY_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID='kyrub-security-test';
process.env.GCLOUD_PROJECT='kyrub-security-test';

const operator='liability_op', reviewer='liability_reviewer', store='liability_store';
const seed=async(deliveryId:string,condition:'intact'|'damaged'='intact')=>{
  const at=Timestamp.now(),courier='courier_'+deliveryId,orderId='order_'+deliveryId;
  await Promise.all([
    adminDb.doc('kyrub_admin/control_plane/admins/'+operator).set({uid:operator,status:'active',role:'operations'}),
    adminDb.doc('kyrub_admin/control_plane/admins/'+reviewer).set({uid:reviewer,status:'active',role:'compliance'}),
    adminDb.doc('deliveryReturnProtocols/'+deliveryId).set({
      schemaVersion:1,deliveryId,ticketId:'ticket_'+deliveryId,storeId:store,orderId,courierId,
      status:'returned_to_store_pending_reconciliation',financialStatus:'awaiting_independent_reconciliation',
      receivedCondition:condition,receivedByStoreId:store,receivedByStoreAt:at,
    }),
    adminDb.doc('hub/renda/deliveries/'+deliveryId).set({
      id:deliveryId,source:'kyrub-order',status:'returned_to_store',
      acceptedBy:courier,storeId:store,sourceOrderId:orderId,
    }),
    adminDb.doc('deliveryClaims/'+deliveryId).set({courierId:courier,status:'returned_to_store'}),
    adminDb.doc('artifacts/'+store+'/public/data/customerOrders/'+orderId).set({
      deliveryProvider:'kyrub',returnCustody:{status:'received_by_store_pending_financial_review'},
    }),
  ]);
  return {courier,orderId};
};

test('human classification and independent review never change operational custody or funds',async()=>{
  const deliveryId='liability_valid_1';await seed(deliveryId);
  const proposal={deliveryId,operatorId:operator,cause:'recipient_absent',
    justification:'Destinatário ausente; retorno físico conferido, sem atribuir culpa automaticamente.'};
  assert.equal((await getDeliveryReturnLiabilityReview({deliveryId,operatorId:operator})).status,'not_classified');
  await assert.rejects(proposeDeliveryReturnLiabilityReview({...proposal,operatorId:'unknown'}),
    /DELIVERY_RETURN_LIABILITY_FORBIDDEN/);
  const first=await proposeDeliveryReturnLiabilityReview(proposal);
  assert.equal(first.initialFunding,'store');
  assert.equal(first.status,'awaiting_independent_review');
  assert.deepEqual(await proposeDeliveryReturnLiabilityReview(proposal),first);
  await assert.rejects(reviewDeliveryReturnLiability({
    deliveryId,reviewerId:operator,decision:'approve',
    reviewReason:'Não é permitido aprovar a própria classificação de responsabilidade.'}),
    /DELIVERY_RETURN_LIABILITY_FORBIDDEN/);
  const decision={
    deliveryId,reviewerId:reviewer,decision:'approve' as const,
    reviewReason:'Causa conferida independentemente, somente para triagem de responsabilidade.',
  };
  assert.equal((await reviewDeliveryReturnLiability(decision)).status,'approved_no_financial_execution');
  assert.equal((await reviewDeliveryReturnLiability(decision)).status,'approved_no_financial_execution');
  const [claim,delivery,protocol,order,events]=await Promise.all([
    adminDb.doc('deliveryClaims/'+deliveryId).get(),
    adminDb.doc('hub/renda/deliveries/'+deliveryId).get(),
    adminDb.doc('deliveryReturnProtocols/'+deliveryId).get(),
    adminDb.doc('artifacts/'+store+'/public/data/customerOrders/order_'+deliveryId).get(),
    adminDb.collection('deliveryReturnLiabilityReviewEvents').where('deliveryId','==',deliveryId).get(),
  ]);
  assert.equal(events.size,2);
  assert.equal(delivery.data()?.status,'returned_to_store');
  assert.equal(claim.data()?.status,'returned_to_store');
  assert.equal(protocol.data()?.financialStatus,'awaiting_independent_reconciliation');
  assert.equal(order.data()?.returnCustody?.status,'received_by_store_pending_financial_review');
  assert.equal((await adminDb.collection('stores/liability_store/economicObligations').get()).size,0);
});

test('damaged return stays disputed and extra evidence can reopen in a new revision',async()=>{
  const deliveryId='liability_damaged_1';await seed(deliveryId,'damaged');
  const first=await proposeDeliveryReturnLiabilityReview({
    deliveryId,operatorId:operator,cause:'recipient_absent',
    justification:'Recebimento marcado com avaria e sem prova independente de autoria.',
  });
  assert.equal(first.initialFunding,'disputed');
  assert.equal(first.damageReviewRequired,true);
  await reviewDeliveryReturnLiability({
    deliveryId,reviewerId:reviewer,decision:'request_evidence',
    reviewReason:'Faltam evidências independentes sobre a condição física recebida.',
  });
  const next=await proposeDeliveryReturnLiabilityReview({
    deliveryId,operatorId:operator,cause:'damage_or_missing',
    justification:'Reavaliação da divergência do pacote sem imputar culpa ao entregador.',
  });
  assert.equal(next.revision,2);
  assert.equal(next.initialFunding,'disputed');
  const changed=Timestamp.fromMillis(Date.now()+1000);
  await adminDb.doc('deliveryReturnProtocols/'+deliveryId).update({receivedByStoreAt:changed});
  await assert.rejects(reviewDeliveryReturnLiability({
    deliveryId,reviewerId:reviewer,decision:'approve',
    reviewReason:'Deve recusar protocolo modificado desde a proposta inicial.',
  }),/DELIVERY_RETURN_LIABILITY_CONFLICT/);
});
