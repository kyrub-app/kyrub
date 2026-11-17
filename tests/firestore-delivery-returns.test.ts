import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../server/firebaseAdmin';
import {
  authorizeRecipientAbsenceReturn,
  revokeRecipientAbsenceReturn,
  declareCourierReturnAtStore,
  confirmStoreReceivedReturnedDelivery,
} from '../server/delivery/deliveryReturnToStoreService';
import {
  submitCourierSupportTicket,
  respondToCourierSupportTicket,
} from '../server/delivery/deliverySupportTicketService';
import {
  declareRecipientContactAttempt,
  requestRecipientAbsenceReview,
} from '../server/delivery/deliveryRecipientAbsenceEvidenceService';
import {
  markCourierArrivedAtCustomer,
  confirmBuyerReceivedDelivery,
} from '../server/delivery/deliveryCustomerHandoffService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('DELIVERY_RETURN_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
process.env.GCLOUD_PROJECT = 'kyrub-security-test';

const op='return_ops_admin';
const store='return_shop_1';
const buyer='return_buyer_1';
const seed=async(deliveryId:string,corroboratedArrival=false)=>{
  const courierId='return_driver_'+deliveryId;
  const orderId='return_order_'+deliveryId;
  const ticketId='return_ticket_'+deliveryId;
  const at=Timestamp.now();
  await Promise.all([
    adminDb.doc(`kyrub_admin/control_plane/admins/${op}`).set({
      uid:op,role:'operations',status:'active',
    }),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).set({
      id:deliveryId,storeId:store,sourceOrderId:orderId,
      buyerId:buyer,source:'kyrub-order',acceptedBy:courierId,
      status:'delivering',vehicleType:'bicycle',
      collectedAt:at,from:'Loja de teste',to:'Destinatário de teste',
    }),
    adminDb.doc(`deliveryClaims/${deliveryId}`).set({
      deliveryJobId:deliveryId,courierId,status:'delivering',
      vehicleType:'bicycle',collectedAt:at,
    }),
    adminDb.doc(`deliveryTracking/${deliveryId}`).set({
      deliveryId,courierId,active:true,
      latitude:-23.55,longitude:-46.63,accuracy:10,
      updatedAt:at,
    }),
    adminDb.doc(`artifacts/${store}/public/data/customerOrders/${orderId}`).set({
      id:orderId,buyerId:buyer,fulfillmentType:'delivery',
      deliveryProvider:'kyrub',status:'out_for_delivery',
    }),
  ]);
  if(corroboratedArrival){
    await adminDb.doc('deliveryTracking/'+deliveryId).update({
      updatedAt:Timestamp.now(),
      customerArrivalAssessment:{
        configured:true,authoritativeDestination:true,insideGeofence:true,
        distanceMeters:8,radiusMeters:100,accuracyMeters:12,
        evaluatedAt:Timestamp.now(),
      },
    });
  }
  await markCourierArrivedAtCustomer({deliveryId,courierId});
  await submitCourierSupportTicket({
    deliveryId,courierId,ticketId,
    reasonCode:'recipient_not_found',
    detail:'Destinatário ausente no horário da chegada registrada.',
  });
  await declareRecipientContactAttempt({
    ticketId,courierId,attemptId:'attempt_000000000000000001',
    method:'called_recipient',
  });
  await requestRecipientAbsenceReview({ticketId,courierId});
  await respondToCourierSupportTicket({
    ticketId,operatorId:op,action:'take',response:'',
  });
  return {courierId,orderId,ticketId};
};

test('authorized return requires ticket ownership, server arrival and absence review; buyer cannot finalize while return authorized', async()=>{
  const deliveryId='return_authorize_case';
  const {courierId,ticketId}=await seed(deliveryId);
  await assert.rejects(authorizeRecipientAbsenceReturn({
    ticketId,operatorId:'unknown_operator',
    reason:'A logística verificou a situação e autoriza o retorno.',
  }),/DELIVERY_RETURN_FORBIDDEN/);
  const input={
    ticketId,operatorId:op,
    reason:'Tentativa de contato sem resposta; retorno supervisionado à loja.',
  };
  const approved=await authorizeRecipientAbsenceReturn(input);
  assert.equal(approved.status,'return_authorized');
  assert.deepEqual(await authorizeRecipientAbsenceReturn(input),approved);
  await assert.rejects(confirmBuyerReceivedDelivery({
    deliveryId,buyerId:buyer,
  }),/DELIVERY_RETURN_CUSTODY_HOLD/);
  await assert.rejects(markCourierArrivedAtCustomer({
    deliveryId,courierId,
  }),/DELIVERY_RETURN_CUSTODY_HOLD/);

  await assert.rejects(declareCourierReturnAtStore({
    deliveryId,courierId:'another_courier',
  }),/DELIVERY_RETURN_FORBIDDEN/);
  await assert.rejects(declareCourierReturnAtStore({
    deliveryId,courierId,
  }),/DELIVERY_RETURN_STORE_GEOFENCE_REQUIRED/);
  const arrival=Timestamp.now();
  await adminDb.doc(`deliveryTracking/${deliveryId}`).update({
    updatedAt:arrival,
    storeArrivalAssessment:{
      configured:true,insideGeofence:true,distanceMeters:12,
      radiusMeters:100,accuracyMeters:9,
      evaluatedAt:Timestamp.fromMillis(Date.now()-160_000),
    },
  });
  await assert.rejects(declareCourierReturnAtStore({
    deliveryId,courierId,
  }),/DELIVERY_RETURN_STORE_GEOFENCE_REQUIRED/);
  await adminDb.doc(`deliveryTracking/${deliveryId}`).update({
    updatedAt:Timestamp.now(),
    'storeArrivalAssessment.evaluatedAt':Timestamp.now(),
  });
  const declared=await declareCourierReturnAtStore({deliveryId,courierId});
  assert.equal(declared.status,'courier_presented_to_store');
  assert.deepEqual(await declareCourierReturnAtStore({deliveryId,courierId}),declared);
  await assert.rejects(revokeRecipientAbsenceReturn({
    deliveryId,operatorId:op,
    reason:'Não é possível revogar após a apresentação física na loja.',
  }),/DELIVERY_RETURN_CONFLICT/);

  await assert.rejects(confirmStoreReceivedReturnedDelivery({
    deliveryId,storeId:'unrelated_store',condition:'intact',
    note:'Não é a loja original responsável pela entrega.',
  }),/DELIVERY_RETURN_FORBIDDEN/);
  const receipt={
    deliveryId,storeId:store,
    condition:'intact' as const,
    note:'Conferi o pacote lacrado em mãos, mesmo entregador identificado.',
  };
  const received=await confirmStoreReceivedReturnedDelivery(receipt);
  assert.equal(received.status,'returned_to_store_pending_reconciliation');
  assert.deepEqual(await confirmStoreReceivedReturnedDelivery(receipt),received);
  await assert.rejects(confirmStoreReceivedReturnedDelivery({
    ...receipt,condition:'damaged',
  }),/DELIVERY_RETURN_CONFLICT/);

  const [protocol,delivery,claim,offer,tracking,order,completion,events] = await Promise.all([
    adminDb.doc(`deliveryReturnProtocols/${deliveryId}`).get(),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get(),
    adminDb.doc(`deliveryClaims/${deliveryId}`).get(),
    adminDb.doc(`hub/renda/deliveryOffers/${deliveryId}`).get(),
    adminDb.doc(`deliveryTracking/${deliveryId}`).get(),
    adminDb.doc(`artifacts/${store}/public/data/customerOrders/${'return_order_'+deliveryId}`).get(),
    adminDb.doc(`deliveryCompletions/${deliveryId}`).get(),
    adminDb.collection('deliveryReturnEvents').where('deliveryId','==',deliveryId).get(),
  ]);
  assert.equal(protocol.data()?.status,'returned_to_store_pending_reconciliation');
  assert.equal(protocol.data()?.financialStatus,'awaiting_independent_reconciliation');
  assert.equal(delivery.data()?.status,'returned_to_store');
  assert.equal(delivery.data()?.returnCustody?.status,'received_by_store_pending_financial_review');
  assert.equal(claim.data()?.status,'returned_to_store');
  assert.equal(offer.data()?.status,'returned_to_store');
  assert.equal(tracking.data()?.active,false);
  assert.equal(tracking.data()?.latitude,undefined);
  assert.equal(tracking.data()?.longitude,undefined);
  assert.equal(order.data()?.status,'out_for_delivery'); // unchanged until economic review
  assert.equal(order.data()?.returnCustody?.status,'received_by_store_pending_financial_review');
  assert.equal(completion.exists,false);
  assert.equal(events.size,3); // operator, courier, shop, each once
  assert.equal(events.docs.filter(x=>x.data().action==='store_physically_received_return').length,1);
  await assert.rejects(confirmBuyerReceivedDelivery({
    deliveryId,buyerId:buyer,
  }),/DELIVERY_RETURN_CUSTODY_HOLD/);
});

test('authorization may be revoked before physical presentation and restores buyer confirmation path',async()=>{
  const deliveryId='return_revoke_case';
  const {courierId,ticketId}=await seed(deliveryId);
  await authorizeRecipientAbsenceReturn({
    ticketId,operatorId:op,
    reason:'Retorno aprovado porque o cliente não respondeu às tentativas.',
  });
  const note='Comprador voltou a atender e pediu conclusão da entrega original.';
  assert.equal((await revokeRecipientAbsenceReturn({
    deliveryId,operatorId:op,reason:note,
  })).status,'authorization_revoked');
  assert.equal((await revokeRecipientAbsenceReturn({
    deliveryId,operatorId:op,reason:note,
  })).status,'authorization_revoked');
  assert.equal((await adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get())
    .data()?.returnCustody?.status,'authorization_revoked');
  await assert.rejects(declareCourierReturnAtStore({deliveryId,courierId}),
    /DELIVERY_RETURN_CONFLICT/);
  // The original buyer completion flow can proceed normally after revocation,
  // without creating any return or paid waiting economic obligation.
  const result=await confirmBuyerReceivedDelivery({deliveryId,buyerId:buyer});
  assert.equal(result.status,'done');
  assert.equal((await adminDb.doc(`deliveryReturnProtocols/${deliveryId}`).get())
    .data()?.status,'authorization_revoked');
  const events=await adminDb.collection('deliveryReturnEvents')
    .where('deliveryId','==',deliveryId).get();
  assert.equal(events.size,2);
});

test('store cannot receive without courier declaration or while a separate handoff exists',async()=>{
  const deliveryId='return_store_guard_case';
  const {ticketId,courierId}=await seed(deliveryId);
  await authorizeRecipientAbsenceReturn({
    ticketId,operatorId:op,
    reason:'Cliente ausente, logística solicitou retorno à loja de origem.',
  });
  await assert.rejects(confirmStoreReceivedReturnedDelivery({
    deliveryId,storeId:store,condition:'intact',
    note:'Não recebi o pacote nem a confirmação do entregador.',
  }),/DELIVERY_RETURN_CONFLICT/);
  await adminDb.doc(`deliveryTracking/${deliveryId}`).update({
    active:false,updatedAt:Timestamp.now(),
    storeArrivalAssessment:{insideGeofence:true,configured:true,
      accuracyMeters:10,evaluatedAt:Timestamp.now()},
  });
  await assert.rejects(declareCourierReturnAtStore({deliveryId,courierId}),
    /DELIVERY_RETURN_STORE_GEOFENCE_REQUIRED/);
  assert.equal((await adminDb.doc(`deliveryClaims/${deliveryId}`).get())
    .data()?.status,'delivering');
});

test('recipient wait evidence is corroborated only with recent server geofence and independent return authorization',async()=>{
  const deliveryId='return_wait_corrob';
  const {ticketId}=await seed(deliveryId,true);
  const handoff=(await adminDb.doc('hub/renda/deliveries/'+deliveryId).get()).data()?.customerHandoff;
  assert.equal(handoff?.arrivalCorroboration?.verified,true);
  await authorizeRecipientAbsenceReturn({
    ticketId,operatorId:op,
    reason:'Contato declarado e localização do cliente corroborada por geofence atual.',
  });
  const protocol=(await adminDb.doc('deliveryReturnProtocols/'+deliveryId).get()).data();
  assert.equal(protocol?.recipientWaitingCorroboratedInterval?.verified,true);
  assert.equal(protocol?.recipientWaitingCorroboratedInterval?.source,'corroborated_server_interval');
  assert.equal(protocol?.recipientWaitingCorroboratedInterval?.returnAuthorizedAt,
    protocol?.authorizedAt?.toDate().toISOString());
  assert.equal((await adminDb.doc('deliveryCompletions/'+deliveryId).get()).exists,false);
});

test('arrival without independently verified customer geofence never fabricates a billable interval',async()=>{
  const deliveryId='return_wait_self_declared';
  const {ticketId}=await seed(deliveryId);
  const handoff=(await adminDb.doc('hub/renda/deliveries/'+deliveryId).get()).data()?.customerHandoff;
  assert.equal(handoff?.arrivalCorroboration?.verified,false);
  await authorizeRecipientAbsenceReturn({
    ticketId,operatorId:op,
    reason:'Destinatário não encontrado, sem prova independente da chegada física.',
  });
  const protocol=(await adminDb.doc('deliveryReturnProtocols/'+deliveryId).get()).data();
  assert.equal(protocol?.recipientWaitingCorroboratedInterval,null);
});
