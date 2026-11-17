import assert from 'node:assert/strict';
import test from 'node:test';
import { adminDb } from '../server/firebaseAdmin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  declareRecipientContactAttempt,
  requestRecipientAbsenceReview,
  MAX_DECLARED_CONTACT_ATTEMPTS,
} from '../server/delivery/deliveryRecipientAbsenceEvidenceService';
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

test('recipient absence attempts require recorded customer arrival, assigned courier and real open ticket',async()=>{
  const deliveryId='support_absence_verified';
  const courierId='support_absence_courier';
  const ticketId='support_absence_ticket_01234567890';
  await seed(deliveryId,courierId,'delivering');
  await submitCourierSupportTicket({
    deliveryId,courierId,ticketId,reasonCode:'recipient_not_found',
    detail:'Cliente não apareceu depois de minha chegada.',
  });
  await assert.rejects(declareRecipientContactAttempt({
    ticketId,courierId,attemptId:'attempt_one_0123456789',method:'called_recipient',
  }),/RECIPIENT_ABSENCE_CONFLICT/);
  await assert.rejects(requestRecipientAbsenceReview({
    ticketId,courierId,
  }),/RECIPIENT_ABSENCE_CONFLICT/);
  const arrivedAt=Timestamp.fromMillis(Date.now()-180_000);
  await adminDb.doc(`hub/renda/deliveries/${deliveryId}`).update({
    customerHandoff:{
      status:'awaiting_buyer_confirmation',arrivedByCourierId:courierId,
      arrivedAt,trackingWasActive:true,
    },
  });
  await assert.rejects(requestRecipientAbsenceReview({
    ticketId,courierId,
  }),/RECIPIENT_ABSENCE_CONTACT_REQUIRED/);
  await assert.rejects(declareRecipientContactAttempt({
    ticketId,courierId:'other_courier',
    attemptId:'attempt_unauthorized_01234567',method:'called_recipient',
  }),/RECIPIENT_ABSENCE_FORBIDDEN/);
  const first={
    ticketId,courierId,attemptId:'attempt_one_0123456789',
    method:'called_recipient' as const,
  };
  const recorded=await declareRecipientContactAttempt(first);
  assert.equal(recorded.attempts,1);
  assert.equal(recorded.arrivedAtEpochMs,arrivedAt.toMillis());
  assert.deepEqual(await declareRecipientContactAttempt(first),recorded);
  await assert.rejects(declareRecipientContactAttempt({
    ...first,method:'messaged_recipient',
  }),/RECIPIENT_ABSENCE_CONFLICT/);
  const second=await declareRecipientContactAttempt({
    ticketId,courierId,attemptId:'attempt_two_0123456789',
    method:'messaged_recipient',
  });
  assert.equal(second.attempts,2);
  const request=await requestRecipientAbsenceReview({ticketId,courierId});
  assert.equal(request.status,'review_requested');
  assert.equal(request.attempts,2);
  assert.ok(request.elapsedMs>=150_000);
  assert.equal((await requestRecipientAbsenceReview({ticketId,courierId})).status,
    'review_requested');

  const [ticket,events,delivery,claim,completion]=await Promise.all([
    adminDb.doc(`deliverySupportTickets/${ticketId}`).get(),
    adminDb.collection('deliverySupportTicketEvents').where('ticketId','==',ticketId).get(),
    adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get(),
    adminDb.doc(`deliveryClaims/${deliveryId}`).get(),
    adminDb.doc(`deliveryCompletions/${deliveryId}`).get(),
  ]);
  assert.equal(ticket.data()?.contactAttemptsCount,2);
  assert.equal(ticket.data()?.recipientArrivedAt.toMillis(),arrivedAt.toMillis());
  assert.ok(ticket.data()?.recipientAbsenceReviewRequestedAt);
  assert.equal(events.size,4); // opening, two declared attempts, review
  assert.equal(events.docs.filter(x=>x.data().action==='contact_attempt_declared').length,2);
  assert.equal(events.docs.filter(x=>x.data().method==='called_recipient').length,1);
  assert.equal(events.docs.filter(x=>x.data().evidenceLevel==='courier_self_declared').length,3);
  assert.equal(delivery.data()?.status,'delivering');
  assert.equal(delivery.data()?.acceptedBy,courierId);
  assert.equal(claim.data()?.courierId,courierId);
  assert.equal(completion.exists,false);
  for(const event of events.docs){
    assert.equal(event.data().latitude,undefined);
    assert.equal(event.data().phone,undefined);
    assert.equal(event.data().messageContent,undefined);
  }
});

test('recipient absence cannot be extended after handoff, resolution or active courier reassignment',async()=>{
  const deliveryId='support_absence_reassignment';
  const courierId='support_absence_original';
  const ticketId='support_absence_other_01234567890';
  await seed(deliveryId,courierId,'delivering');
  await submitCourierSupportTicket({
    deliveryId,courierId,ticketId,reasonCode:'recipient_not_found',
    detail:'Destinatário ausente no endereço informado.',
  });
  await adminDb.doc(`hub/renda/deliveries/${deliveryId}`).update({
    customerHandoff:{
      status:'awaiting_buyer_confirmation',
      arrivedByCourierId:courierId,
      arrivedAt:Timestamp.fromMillis(Date.now()-60_000),
      trackingWasActive:true,
    },
  });
  await adminDb.doc(`deliverySupportTickets/${ticketId}`).update({
    contactAttemptsCount:MAX_DECLARED_CONTACT_ATTEMPTS,
  });
  await assert.rejects(declareRecipientContactAttempt({
    ticketId,courierId,attemptId:'attempt_exceeds_limit_0123456',
    method:'tried_intercom',
  }),/RECIPIENT_ABSENCE_LIMIT/);
  await adminDb.doc(`deliverySupportTickets/${ticketId}`).update({
    contactAttemptsCount:0,
  });
  await adminDb.doc(`deliveryClaims/${deliveryId}`).update({
    courierId:'replacement_courier',
  });
  await assert.rejects(declareRecipientContactAttempt({
    ticketId,courierId,attemptId:'attempt_wrong_custody_012345',
    method:'tried_intercom',
  }),/RECIPIENT_ABSENCE_CONFLICT/);
  await assert.rejects(requestRecipientAbsenceReview({
    ticketId,courierId,
  }),/RECIPIENT_ABSENCE_CONFLICT/);
});

test('no-show review never enforces a ten-minute cancellation rule',async()=>{
  const deliveryId='support_absence_immediate_review';
  const courierId='support_absence_fast_courier';
  const ticketId='support_absence_fast_01234567890';
  await seed(deliveryId,courierId,'delivering');
  await submitCourierSupportTicket({
    deliveryId,courierId,ticketId,reasonCode:'recipient_not_found',
    detail:'Solicitada orientação para segurança do pacote.',
  });
  await adminDb.doc(`hub/renda/deliveries/${deliveryId}`).update({
    customerHandoff:{
      status:'awaiting_buyer_confirmation',arrivedByCourierId:courierId,
      arrivedAt:Timestamp.fromMillis(Date.now()-2_000),trackingWasActive:true,
    },
  });
  await declareRecipientContactAttempt({
    ticketId,courierId,attemptId:'attempt_fast_0123456789',method:'tried_intercom',
  });
  const review=await requestRecipientAbsenceReview({ticketId,courierId});
  assert.equal(review.status,'review_requested');
  assert.ok(review.elapsedMs<120_000);
  assert.equal((await adminDb.doc(`hub/renda/deliveries/${deliveryId}`).get())
    .data()?.status,'delivering');
});
