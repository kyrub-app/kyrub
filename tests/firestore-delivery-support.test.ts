import assert from 'node:assert/strict';
import test from 'node:test';
import { adminDb } from '../server/firebaseAdmin';
import {
  submitCourierSupportTicket,
  respondToCourierSupportTicket,
} from '../server/delivery/deliverySupportTicketService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('COURIER_SUPPORT_TEST_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID='kyrub-security-test';
process.env.GCLOUD_PROJECT='kyrub-security-test';

const storeId='support_store';
const orderId='support_order';

const seed=async(deliveryId:string,courierId:string,status:'accepted'|'delivering'='accepted')=>{
  await Promise.all([
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).set({
      id:deliveryId,source:'kyrub-order',
      storeId,sourceOrderId:orderId,acceptedBy:courierId,status,
    }),
    adminDb.doc(`deliveryClaims/${deliveryId}`).set({
      deliveryJobId:deliveryId,courierId,status,
    }),
    adminDb.doc('kyrub_admin/control_plane/admins/support_operator_a').set({
      uid:'support_operator_a',role:'operations',status:'active',
    }),
    adminDb.doc('kyrub_admin/control_plane/admins/support_compliance_b').set({
      uid:'support_compliance_b',role:'compliance',status:'active',
    }),
  ]);
};

test('reporting a pickup problem creates private idempotent ticket without changing delivery or claim',async()=>{
  const deliveryId='support_pickup_test';
  const courierId='support_pickup_courier';
  await seed(deliveryId,courierId);
  const args={
    ticketId:'support_pickup_0123456789',
    deliveryId,courierId,
    reasonCode:'merchant_closed',
    detail:'O local está fechado desde o início da manhã.',
  };
  const created=await submitCourierSupportTicket(args);
  assert.equal(created.priority,'urgent');
  assert.equal(created.status,'open');
  assert.deepEqual(await submitCourierSupportTicket(args),created);
  await assert.rejects(submitCourierSupportTicket({
    ...args,reasonCode:'recipient_not_found',ticketId:'support_invalid_01234567',
  }),/DELIVERY_SUPPORT_INVALID/);
  await assert.rejects(submitCourierSupportTicket({
    ...args,courierId:'support_imposter',ticketId:'support_imposter_0123456',
  }),/DELIVERY_SUPPORT_FORBIDDEN/);
  await assert.rejects(submitCourierSupportTicket({
    ...args,ticketId:'support_second_0123456789',
  }),/DELIVERY_SUPPORT_RATE_LIMIT/);
  const [ticket,delivery,claim,events]=await Promise.all([
    adminDb.doc(`deliverySupportTickets/${args.ticketId}`).get(),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get(),
    adminDb.doc(`deliveryClaims/${deliveryId}`).get(),
    adminDb.collection('deliverySupportTicketEvents').where('ticketId','==',args.ticketId).get(),
  ]);
  assert.equal(ticket.data()?.reasonCode,'merchant_closed');
  assert.equal(ticket.data()?.detail,args.detail);
  assert.equal(ticket.data()?.status,'open');
  assert.equal(ticket.data()?.latitude,undefined);
  assert.equal(ticket.data()?.longitude,undefined);
  assert.equal(delivery.data()?.status,'accepted');
  assert.equal(delivery.data()?.acceptedBy,courierId);
  assert.equal(claim.data()?.courierId,courierId);
  assert.equal(events.size,1);
});

test('safety report bypasses ordinary cooldown but does not dispatch emergency services or cancel',async()=>{
  const deliveryId='support_safety_test';
  const courierId='support_safety_courier';
  await seed(deliveryId,courierId,'delivering');
  await submitCourierSupportTicket({
    deliveryId,courierId,ticketId:'support_regular_0123456789',
    reasonCode:'app_location_or_connection',detail:'',
  });
  const emergency=await submitCourierSupportTicket({
    deliveryId,courierId,ticketId:'support_emergency_0123456789',
    reasonCode:'accident_or_injury',detail:'',
  });
  assert.equal(emergency.priority,'safety');
  assert.equal((await adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get())
    .data()?.status,'delivering');
  await assert.rejects(submitCourierSupportTicket({
    deliveryId,courierId,ticketId:'support_wrong_stage_1234567',
    reasonCode:'merchant_closed',detail:'',
  }),/DELIVERY_SUPPORT_INVALID/);
});

test('only active authorized staff may take, reply and resolve; every action audited with no settlement',async()=>{
  const deliveryId='support_admin_test';
  const courierId='support_admin_courier';
  const id='support_staff_0123456789';
  await seed(deliveryId,courierId,'delivering');
  await submitCourierSupportTicket({
    deliveryId,courierId,ticketId:id,reasonCode:'recipient_not_found',
    detail:'O destinatário não atende às tentativas de contato.',
  });
  await assert.rejects(respondToCourierSupportTicket({
    ticketId:id,operatorId:'support_imposter',action:'resolve',
    response:'Pedido encerrado sem contato.',
  }),/DELIVERY_SUPPORT_FORBIDDEN/);
  assert.equal((await respondToCourierSupportTicket({
    ticketId:id,operatorId:'support_operator_a',action:'take',response:'',
  })).status,'working');
  await respondToCourierSupportTicket({
    ticketId:id,operatorId:'support_operator_a',action:'reply',
    response:'Continue em local seguro e tente contato pelo aplicativo.',
  });
  await assert.rejects(respondToCourierSupportTicket({
    ticketId:id,operatorId:'support_compliance_b',action:'resolve',
    response:'Outro operador não pode resolver sem assumir o chamado.',
  }),/DELIVERY_SUPPORT_CONFLICT/);
  assert.equal((await respondToCourierSupportTicket({
    ticketId:id,operatorId:'support_operator_a',action:'resolve',
    response:'Acompanhamento logístico concluído. O pedido permanece sob sua responsabilidade.',
  })).status,'resolved');
  assert.equal((await respondToCourierSupportTicket({
    ticketId:id,operatorId:'support_operator_a',action:'resolve',
    response:'Acompanhamento logístico concluído. O pedido permanece sob sua responsabilidade.',
  })).status,'resolved');
  await assert.rejects(respondToCourierSupportTicket({
    ticketId:id,operatorId:'support_operator_a',action:'reply',
    response:'Esta resposta não deve ser aceita após o encerramento.',
  }),/DELIVERY_SUPPORT_CONFLICT/);
  const [ticket,events,delivery,completion]=await Promise.all([
    adminDb.doc(`deliverySupportTickets/${id}`).get(),
    adminDb.collection('deliverySupportTicketEvents').where('ticketId','==',id).get(),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get(),
    adminDb.doc(`deliveryCompletions/${deliveryId}`).get(),
  ]);
  assert.equal(ticket.data()?.status,'resolved');
  assert.equal(ticket.data()?.assignedTo,'support_operator_a');
  assert.equal(events.size,4);
  assert.equal(delivery.data()?.status,'delivering');
  assert.equal(completion.exists,false);
});
