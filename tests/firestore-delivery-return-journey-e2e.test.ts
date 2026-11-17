import assert from 'node:assert/strict';
import test from 'node:test';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../server/firebaseAdmin';
import { buildEconomicAllocationSnapshot } from '../shared/economicFeesSubsidies';
import { buildDeliveryCustomerDestinationResolution } from '../shared/deliveryCustomerDestinationResolution';
import { publishKyrubDeliveryOpportunity, updateKyrubDeliveryStatus } from '../server/delivery/deliveryOpportunityRouter';
import {
  readOrCreateDeliveryPickupCodeForStore, confirmSecureCourierPickupAndStartRoute,
} from '../server/delivery/deliveryPickupHandoffService';
import { markCourierArrivedAtCustomer, confirmBuyerReceivedDelivery } from '../server/delivery/deliveryCustomerHandoffService';
import { submitCourierSupportTicket, respondToCourierSupportTicket } from '../server/delivery/deliverySupportTicketService';
import { declareRecipientContactAttempt, requestRecipientAbsenceReview } from '../server/delivery/deliveryRecipientAbsenceEvidenceService';
import {
  authorizeRecipientAbsenceReturn, declareCourierReturnAtStore,
  confirmStoreReceivedReturnedDelivery,
} from '../server/delivery/deliveryReturnToStoreService';
import { previewDeliveryReturnEconomicReconciliation } from '../server/delivery/deliveryReturnEconomicReviewService';
import { proposeDeliveryReturnLiabilityReview, reviewDeliveryReturnLiability } from '../server/delivery/deliveryReturnLiabilityReviewService';
import { verifyIndependentReturnDistance } from '../server/delivery/deliveryReturnRouteVerificationService';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('E2E_DELIVERY_RETURN_REQUIRES_FIRESTORE_EMULATOR');
}
process.env.FIREBASE_PROJECT_ID = 'kyrub-security-test';
process.env.GCLOUD_PROJECT = 'kyrub-security-test';

/**
 * Multi-actor integration using the actual server services, in the isolated
 * Firestore Emulator. GPS assessments and the final route estimate are explicitly
 * SYNTHETIC TEST FIXTURES. No Google, Mercado Pago, device GPS or real money.
 */
test('ERP offer -> signed courier acceptance -> secure pickup -> arrival -> support -> supervised return -> independent financial review', async () => {
  const store = 'journey_shop_1';
  const canonicalStore = 'journey_canonical_1';
  const courier = 'journey_bicycle_driver';
  const otherCourier = 'journey_wrong_driver';
  const buyer = 'journey_buyer_1';
  const operator = 'journey_logistics_operator';
  const reviewer = 'journey_financial_reviewer';
  const orderId = 'journey_order_1';
  const address = 'Rua da Loja 100, Centro, Sao Paulo, Brasil';
  const privateDestination = 'Rua do Cliente 88, Sao Paulo, Brasil';
  const now = new Date();
  const tariffPolicy = {
    enabled:true,policyId:'journey_fixture_tariff',version:1,
    effectiveFrom:new Date(now.getTime()-60_000).toISOString(),currency:'BRL',
    returnRateMinorPerKm:150,returnMinimumMinor:400,
    recipientGraceMinutes:10,waitingIncrementMinutes:5,
    waitingRateMinorPerIncrement:100,waitingMaxMinor:500,
    waitingOperationalLimitMinutes:40,
  };
  const geo = buildDeliveryCustomerDestinationResolution({
    inputAddress:privateDestination,
    formattedAddress:privateDestination,
    placeId:'journey_fixture_place',
    latitude:-23.5501,longitude:-46.6302,
    locationType:'ROOFTOP',partialMatch:false,
    resolvedAt:new Date(now.getTime()-5_000).toISOString(),
  });
  const cargo = {
    kind:'parcel',weightKg:2,lengthCm:30,widthCm:20,heightCm:10,
    requiresSpecialHandling:false,
  };
  await Promise.all([
    adminDb.doc('users/'+store+'/stores/'+store).set({name:'Loja do teste',address}),
    adminDb.doc('tenants/'+store).set({canonicalStoreId:canonicalStore}),
    adminDb.doc('identity_verifications/'+courier).set({
      uid:courier,status:'approved',approvedProfiles:['bicycle_courier'],
    }),
    adminDb.doc('identity_verifications/'+otherCourier).set({
      uid:otherCourier,status:'approved',approvedProfiles:['bicycle_courier'],
    }),
    adminDb.doc('platformEconomicPolicies/deliveryRecipientReturnTariff').set(tariffPolicy),
    adminDb.doc('platformOperationalPolicies/deliveryCustomerArrival').set({
      enabled:true,policyId:'journey_geo_policy',version:1,radiusMeters:80,
    }),
    adminDb.doc('kyrub_admin/control_plane/admins/'+operator).set({
      uid:operator,status:'active',role:'operations',
    }),
    adminDb.doc('kyrub_admin/control_plane/admins/'+reviewer).set({
      uid:reviewer,status:'active',role:'compliance',
    }),
    adminDb.doc('artifacts/'+store+'/public/data/customerOrders/'+orderId).set({
      id:orderId,buyerId:buyer,fulfillmentType:'delivery',deliveryProvider:'kyrub',
      status:'ready',deliveryAddress:privateDestination,deliveryFee:12,total:52,
      deliveryCargo:cargo,
      customerDestinationResolutionStatus:'resolved',
      customerDestinationResolution:geo,
    }),
  ]);

  // Store publication is server-authoritative, with the buyer's location
  // excluded from the public opportunity despite the canonical geofence.
  const publication=await publishKyrubDeliveryOpportunity(store,orderId);
  const deliveryId=String(publication.id);
  const privateSnap=await adminDb.doc('hub/renda/deliveries/'+deliveryId).get();
  const publicSnap=await adminDb.doc('hub/renda/deliveryOffers/'+deliveryId).get();
  assert.equal(privateSnap.data()?.customerGeofenceSnapshotStatus,'captured');
  assert.equal(privateSnap.data()?.customerGeofenceSnapshot?.authority,'kyrub_server');
  const publicOffer=publicSnap.data();
  assert.equal(publicOffer?.returnTariffOffer?.policyId,tariffPolicy.policyId);
  assert.equal(publicOffer?.status,'available');
  assert.ok(!JSON.stringify(publicOffer).includes(privateDestination));
  assert.ok(!JSON.stringify(publicOffer).includes(buyer));
  assert.ok(!JSON.stringify(publicOffer).includes('latitude'));

  const fingerprint=String(publicOffer?.returnTariffOffer?.fingerprint);
  const consent={fingerprint,confirmed:true};
  const actor={uid:courier,name:'Entregador de Teste'};
  await assert.rejects(updateKyrubDeliveryStatus(deliveryId,'accepted',actor,'bicycle'),
    /DELIVERY_RETURN_TARIFF_ACCEPTANCE_REQUIRED/);
  await assert.rejects(updateKyrubDeliveryStatus(deliveryId,'accepted',actor,'bicycle',{
    fingerprint:'tampered',confirmed:true,
  }),/DELIVERY_RETURN_TARIFF_ACCEPTANCE_REQUIRED/);
  await updateKyrubDeliveryStatus(deliveryId,'accepted',actor,'bicycle',consent);
  await updateKyrubDeliveryStatus(deliveryId,'accepted',actor,'bicycle',consent);
  await assert.rejects(updateKyrubDeliveryStatus(deliveryId,'accepted',
    {uid:otherCourier,name:'Outro Entregador'},'bicycle',consent),
    /Outro entregador já aceitou/);
  const accepted=await adminDb.doc('deliveryClaims/'+deliveryId).get();
  assert.equal(accepted.data()?.returnTariffAcceptedTerms?.courierId,courier);
  assert.equal(accepted.data()?.returnTariffAcceptedTerms?.offerFingerprint,fingerprint);
  assert.equal(accepted.data()?.returnTariffAcceptedTerms?.acceptedVia,'server_courier_claim');
  assert.equal((await adminDb.doc('hub/renda/deliveries/'+deliveryId).get()).data()?.acceptedBy,courier);

  // Store code cannot be used without active GPS and store-arrival evidence.
  const code=await readOrCreateDeliveryPickupCodeForStore({deliveryId,storeId:store});
  await assert.rejects(confirmSecureCourierPickupAndStartRoute({
    deliveryId,courierId:courier,handoffCode:code.code,
  }),/rastreio|loja/i);
  const initialGps=Timestamp.now();
  await adminDb.doc('deliveryTracking/'+deliveryId).set({
    deliveryId,courierId:courier,active:true,
    latitude:-23.5505,longitude:-46.6295,accuracy:12,
    storeArrivalEvidence:{kind:'courier_inside_store_geofence',
      detectedAt:initialGps,accuracyMeters:12,distanceMeters:9,radiusMeters:80},
    updatedAt:initialGps,
  });
  const wrongCode=code.code==='000000'?'000001':'000000';
  await assert.rejects(confirmSecureCourierPickupAndStartRoute({
    deliveryId,courierId:courier,handoffCode:wrongCode,
  }),/Código incorreto/);
  assert.equal((await confirmSecureCourierPickupAndStartRoute({
    deliveryId,courierId:courier,handoffCode:code.code,
  })).status,'delivering');
  assert.equal((await confirmSecureCourierPickupAndStartRoute({
    deliveryId,courierId:courier,handoffCode:code.code,
  })).status,'delivering');
  // This status change models the existing ERP order dispatch after pickup.
  await adminDb.doc('artifacts/'+store+'/public/data/customerOrders/'+orderId)
    .update({status:'out_for_delivery'});

  // A fake GPS sample is translated to a server-owned geofence assessment
  // inside the Emulator. This is NOT a real-device or real-location test.
  const arrivingAt=Timestamp.now();
  await adminDb.doc('deliveryTracking/'+deliveryId).update({
    updatedAt:arrivingAt,
    latitude:-23.5501,longitude:-46.6302,accuracy:11,
    customerArrivalAssessment:{
      configured:true,authoritativeDestination:true,insideGeofence:true,
      accuracyMeters:11,distanceMeters:7,radiusMeters:80,evaluatedAt:arrivingAt,
    },
  });
  await markCourierArrivedAtCustomer({deliveryId,courierId:courier});
  const arrived=(await adminDb.doc('hub/renda/deliveries/'+deliveryId).get())
    .data()?.customerHandoff;
  assert.equal(arrived?.arrivalCorroboration?.verified,true);

  const ticketId='journey_ticket_00000000000001';
  const ticket={deliveryId,courierId:courier,ticketId,
    reasonCode:'recipient_not_found',
    detail:'O destinatario nao foi localizado apos a chegada confirmada no destino.'};
  await submitCourierSupportTicket(ticket);
  await assert.rejects(submitCourierSupportTicket({...ticket,courierId:otherCourier}),
    /DELIVERY_SUPPORT_CONFLICT|DELIVERY_SUPPORT_FORBIDDEN/);
  await declareRecipientContactAttempt({
    ticketId,courierId:courier,attemptId:'journey_contact_0001',
    method:'called_recipient',
  });
  await requestRecipientAbsenceReview({ticketId,courierId:courier});
  await respondToCourierSupportTicket({
    ticketId,operatorId:operator,action:'take',response:'',
  });
  const approved=await authorizeRecipientAbsenceReturn({
    ticketId,operatorId:operator,
    reason:'Contato declarado sem resposta, consulta de suporte e retorno supervisionado.',
  });
  assert.equal(approved.status,'return_authorized');
  const waitEvidence=(await adminDb.doc('deliveryReturnProtocols/'+deliveryId).get())
    .data()?.recipientWaitingCorroboratedInterval;
  assert.equal(waitEvidence?.verified,true);
  await assert.rejects(confirmBuyerReceivedDelivery({deliveryId,buyerId:buyer}),
    /DELIVERY_RETURN_CUSTODY_HOLD/);
  await assert.rejects(confirmStoreReceivedReturnedDelivery({
    deliveryId,storeId:store,condition:'intact',
    note:'Ainda nao foi apresentada encomenda pelo entregador.',
  }),/DELIVERY_RETURN_CONFLICT/);

  await adminDb.doc('deliveryTracking/'+deliveryId).update({
    updatedAt:Timestamp.now(),
    storeArrivalAssessment:{
      configured:true,insideGeofence:true,accuracyMeters:9,distanceMeters:5,
      evaluatedAt:Timestamp.fromMillis(Date.now()-180_000),
    },
  });
  await assert.rejects(declareCourierReturnAtStore({deliveryId,courierId:courier}),
    /DELIVERY_RETURN_STORE_GEOFENCE_REQUIRED/);
  await adminDb.doc('deliveryTracking/'+deliveryId).update({
    updatedAt:Timestamp.now(),
    'storeArrivalAssessment.evaluatedAt':Timestamp.now(),
  });
  assert.equal((await declareCourierReturnAtStore({deliveryId,courierId:courier})).status,
    'courier_presented_to_store');
  const receipt={deliveryId,storeId:store,condition:'intact' as const,
    note:'Loja confirmou recebimento fisico e integridade da encomenda devolvida.'};
  assert.equal((await confirmStoreReceivedReturnedDelivery(receipt)).status,
    'returned_to_store_pending_reconciliation');
  assert.equal((await confirmStoreReceivedReturnedDelivery(receipt)).status,
    'returned_to_store_pending_reconciliation');

  // Ledger fixture represents a captured ERP source; no Mercado Pago call.
  const paymentId='journey_fake_capture_1';
  const captureId='payment:capture:'+paymentId;
  const allocation=buildEconomicAllocationSnapshot({
    merchandiseGrossMinor:4000,customerPaidMinor:5200,deliveryFeeMinor:1200,
  });
  await adminDb.doc('stores/'+canonicalStore+'/economicLedger/'+captureId).set({
    schemaVersion:1,id:captureId,storeId:canonicalStore,
    kind:'payment_capture',currency:'BRL',amountMinor:5200,
    paymentId,paymentIntentId:'journey_fake_intent',orderId,buyerId:buyer,
    paymentContext:'marketplace',paymentMethod:'pix',provider:'mercado_pago',
    providerPaymentId:'journey_fake_provider',providerEventId:'journey_fake_event',
    sourceAuthority:'provider_webhook',reversalOfEntryId:'',
    occurredAt:'2026-11-17T10:00:00.000Z',economicAllocation:allocation,
  });
  const preview=await previewDeliveryReturnEconomicReconciliation({
    deliveryId,operatorId:operator,
  });
  assert.equal(preview.segments[0].amountMinor,1200);
  assert.equal(preview.segments[1].amountMinor,null);
  assert.equal(preview.segments[2].amountMinor,0); // zero elapsed beyond grace, NOT missing authority
  assert.equal(preview.segments[3].amountMinor,null);
  assert.equal(preview.totalRecognizedMinor,null);
  assert.equal(preview.tariffQuote.mayExecuteFinancially,false);

  // Route certification must NOT call the paid provider unless explicitly
  // enabled; in this suite the operational route policy is absent.
  await assert.rejects(verifyIndependentReturnDistance({
    deliveryId,operatorId:reviewer,
  }),/DELIVERY_RETURN_ROUTE_CONFLICT/);

  // A second operator can independently review the cause; neither side
  // can create a payable, refund, checkout or buyer deduction.
  const proposal=await proposeDeliveryReturnLiabilityReview({
    deliveryId,operatorId:operator,cause:'recipient_absent',
    justification:'Pacote recebido intacto, destinatario ausente; revisao da fonte de custeio.',
  });
  assert.equal(proposal.status,'awaiting_independent_review');
  await assert.rejects(reviewDeliveryReturnLiability({
    deliveryId,reviewerId:operator,decision:'approve',
    reviewReason:'Nao pode revisar a propria proposta financeira.',
  }),/DELIVERY_RETURN_LIABILITY_FORBIDDEN/);
  const reviewed=await reviewDeliveryReturnLiability({
    deliveryId,reviewerId:reviewer,decision:'approve',
    reviewReason:'Comprovacao independente da posse e causa, sem execucao financeira.',
  });
  assert.equal(reviewed.status,'approved_no_financial_execution');
  assert.equal(reviewed.financialExecutionAuthorized,false);

  // The independent route fixture is synthetic, not a Google-certified plan.
  // It only exercises the pure economic preview against a trusted-shaped record.
  await adminDb.doc('deliveryReturnProtocols/'+deliveryId).update({
    independentReturnDistanceAuthority:{
      source:'independent_route_plan',approved:true,
      routePlanId:'emulator_only_not_google_certified',distanceMeters:4000,
    },
  });
  const quoted=await previewDeliveryReturnEconomicReconciliation({
    deliveryId,operatorId:reviewer,
  });
  assert.equal(quoted.segments[1].amountMinor,600);
  assert.equal(quoted.segments[2].amountMinor,0);
  assert.equal(quoted.totalRecognizedMinor,null);

  const [delivery,claim,tracking,order,completion,obligations,events,captures]=await Promise.all([
    adminDb.doc('hub/renda/deliveries/'+deliveryId).get(),
    adminDb.doc('deliveryClaims/'+deliveryId).get(),
    adminDb.doc('deliveryTracking/'+deliveryId).get(),
    adminDb.doc('artifacts/'+store+'/public/data/customerOrders/'+orderId).get(),
    adminDb.doc('deliveryCompletions/'+deliveryId).get(),
    adminDb.collection('stores/'+canonicalStore+'/economicObligations').get(),
    adminDb.collection('deliveryReturnEvents').where('deliveryId','==',deliveryId).get(),
    adminDb.collection('stores/'+canonicalStore+'/economicLedger').get(),
  ]);
  assert.equal(delivery.data()?.status,'returned_to_store');
  assert.equal(claim.data()?.status,'returned_to_store');
  assert.equal(tracking.data()?.active,false);
  assert.equal(tracking.data()?.latitude,undefined);
  assert.equal(order.data()?.status,'out_for_delivery');
  assert.equal(completion.exists,false);
  assert.equal(obligations.size,0);
  assert.equal(captures.size,1);
  assert.equal(events.docs.filter(x=>x.data().action==='store_physically_received_return').length,1);
});
